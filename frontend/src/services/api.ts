import axios from 'axios'
import {
  ParsedGraph,
  ModelMetadata,
  InterventionResult,
  SweepResult,
  FullAnalysisResult,
  NodeLayerMapping,
  SensitivityItem,
  InterventionType
} from '../types/api'
import {
  mockParsedGraph,
  mockModelMetadata,
  createMockInterventionResult,
  createMockSweepResult,
  mockFullAnalysis,
  mockMappingList
} from '../mocks/fixtures'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://slick-cotton-unjustly.ngrok-free.dev'
const FORCE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 45000,
  headers: {
    'ngrok-skip-browser-warning': 'true',
  }
})

function mapInterventionTypeToBackend(interventionType: InterventionType): string {
  if (interventionType === 'masking' || interventionType === 'ablate') return 'mask'
  if (interventionType === 'noise') return 'perturb'
  return interventionType
}

function parseBackendGraphResponse(g: any): ParsedGraph {
  const explanations = g.node_explanations || {}
  return {
    metadata: {
      system: g.metadata?.system || 'Uploaded PINN System',
      equation: g.metadata?.equation || '',
      description: g.metadata?.description || '',
      pinn_input: g.metadata?.pinn_input,
      pinn_output: g.metadata?.pinn_output,
      axis_labels: g.metadata?.axis_labels,
      domain: g.metadata?.domain,
      model_name: g.metadata?.model_name
    },
    nodes: (g.nodes || []).map((n: any) => {
      const d = n.data || {}
      const expl = d.explanation || explanations[n.id] || {}
      const explFormula = expl.formula !== 'Not specified in graph metadata' ? expl.formula : undefined
      return {
        id: n.id,
        label: d.label || n.label || expl.title || n.id,
        symbol: d.symbol || n.symbol || n.id,
        type: d.type || n.type || 'intermediate',
        unit: d.unit ?? n.unit,
        description: d.description || n.description || expl.description,
        formula: d.formula || n.formula || explFormula,
        default_value: d.defaultValue ?? d.default_value ?? n.default_value,
        expected_sensitivity_sign: d.expectedSensitivitySign || d.expected_sensitivity_sign || n.expected_sensitivity_sign,
        trend: d.trend || n.trend
      }
    }),
    edges: (g.edges || []).map((e: any) => ({
      source: e.source,
      target: e.target,
      label: e.label || ''
    }))
  }
}

export const api = {
  // Check backend health
  async checkHealth(): Promise<boolean> {
    try {
      const res = await client.get('/', { timeout: 3000 })
      return res.status === 200
    } catch {
      try {
        const res2 = await client.get('/api/health', { timeout: 3000 })
        return res2.status === 200
      } catch {
        return false
      }
    }
  },

  // Upload PyTorch PINN Model (.py), Weights (.pt), and optional Graph (.json)
  async uploadModel(
    modelFile: File,
    weightsFile: File,
    graphFile?: File | null
  ): Promise<{ metadata: ModelMetadata; graph?: ParsedGraph }> {
    if (FORCE_MOCKS) {
      await new Promise((r) => setTimeout(r, 600))
      return {
        metadata: {
          ...mockModelMetadata,
          sessionId: `session_${Date.now()}`
        },
        graph: mockParsedGraph
      }
    }

    const formData = new FormData()
    formData.append('model_py', modelFile)
    formData.append('model_pt', weightsFile)
    if (graphFile) {
      formData.append('graph_json', graphFile)
    }

    const res = await client.post('/api/model/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    const data = res.data
    const arch = data.architecture || {}
    const archLayerNames: string[] = Array.isArray(arch.layers)
      ? arch.layers.map((l: any) => l.name)
      : []

    const layerList: string[] =
      data.perturbable_tensors ||
      data.layer_names ||
      archLayerNames

    const metadata: ModelMetadata = {
      sessionId: data.session_id || data.sessionId,
      modelClass: arch.class_name || data.model_class || data.system || 'PINN_Model',
      totalParameters: data.num_parameters ?? arch.total_params ?? data.total_parameters ?? 0,
      layerNames: layerList,
      perturbableTensors: layerList,
      loadedAt: new Date().toISOString()
    }

    const graphRes = await client.get(`/api/graph?session_id=${metadata.sessionId}`)
    const parsedGraph = parseBackendGraphResponse(graphRes.data)

    return { metadata, graph: parsedGraph }
  },

  // Upload ruleset JSON
  async uploadRuleset(sessionId: string, rulesetFile: File): Promise<ParsedGraph> {
    if (FORCE_MOCKS) return mockParsedGraph

    const formData = new FormData()
    formData.append('rules_file', rulesetFile)
    await client.post(`/api/ruleset/upload?session_id=${sessionId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return await this.getGraph(sessionId)
  },

  // LLM generate ruleset
  async generateRuleset(sessionId: string, apiKey?: string): Promise<ParsedGraph> {
    if (FORCE_MOCKS) return mockParsedGraph

    await client.post('/api/ruleset/generate', {
      session_id: sessionId,
      api_key: apiKey || ''
    })
    return await this.getGraph(sessionId)
  },

  // Get graph
  async getGraph(sessionId: string): Promise<ParsedGraph> {
    if (FORCE_MOCKS) return mockParsedGraph

    const res = await client.get(`/api/graph?session_id=${sessionId}`)
    return parseBackendGraphResponse(res.data)
  },

  // Run Intervention
  async runIntervention(
    sessionId: string,
    layerName: string,
    interventionType: InterventionType,
    strength: number
  ): Promise<InterventionResult> {
    if (FORCE_MOCKS || sessionId.startsWith('demo_')) {
      await new Promise((r) => setTimeout(r, 200))
      return createMockInterventionResult(
        layerName,
        interventionType === 'masking' ? 'masking' : 'noise',
        strength
      )
    }

    const res = await client.post('/api/intervention/run', {
      session_id: sessionId,
      layer_name: layerName,
      intervention_type: mapInterventionTypeToBackend(interventionType),
      strength: strength
    })

    const data = res.data
    const yBaseline: number[] = data.trajectory_baseline || data.trajectories?.baseline || []
    const yIntervened: number[] = data.trajectory_intervened || data.trajectories?.intervened || []
    const yGroundTruth: number[] | undefined =
      data.trajectory_ground_truth || data.trajectories?.ground_truth || undefined

    const xValues: number[] =
      data.x_values && data.x_values.length === yBaseline.length
        ? data.x_values
        : Array.from(
            { length: yBaseline.length },
            (_, i) => i / Math.max(1, yBaseline.length - 1)
          )

    // Compute exact trajectory metrics from returned arrays if needed
    let maxDiv = data.max_divergence
    let sumAbsDiff = 0
    let sumSqDiff = 0
    let sumBaseSq = 0
    let sumInterSq = 0

    for (let i = 0; i < yBaseline.length; i++) {
      const diff = (yIntervened[i] ?? 0) - (yBaseline[i] ?? 0)
      const absDiff = Math.abs(diff)
      sumAbsDiff += absDiff
      sumSqDiff += diff * diff
      sumBaseSq += (yBaseline[i] ?? 0) ** 2
      sumInterSq += (yIntervened[i] ?? 0) ** 2
      if (maxDiv === undefined || absDiff > maxDiv) {
        maxDiv = absDiff
      }
    }

    const n = Math.max(1, yBaseline.length)
    const mseBaseline = data.baseline_mse ?? data.mse_baseline ?? 0
    const mseIntervened = data.intervened_mse ?? data.mse_intervened ?? sumSqDiff / n
    const l2Baseline = data.baseline_l2 ?? data.relative_l2_baseline ?? Math.sqrt(sumBaseSq)
    const l2Intervened = data.intervened_l2 ?? data.relative_l2_intervened ?? Math.sqrt(sumInterSq)
    const rmse = data.rmse ?? Math.sqrt(sumSqDiff / n)
    const mae = data.mae ?? data.trajectory_mean_deviation ?? sumAbsDiff / n
    const percentDegradation =
      data.mse_percent_change ??
      (mseBaseline > 0 ? ((mseIntervened - mseBaseline) / mseBaseline) * 100 : 0)

    return {
      layerName: data.layer || layerName,
      interventionType,
      strength: data.strength ?? strength,
      timestamp: new Date().toISOString(),
      trajectory: {
        xValues,
        yBaseline,
        yIntervened,
        yGroundTruth
      },
      metrics: {
        mseBaseline,
        mseIntervened,
        l2Baseline,
        l2Intervened,
        rmse,
        mae,
        maxDivergence: maxDiv ?? 0,
        percentDegradation
      }
    }
  },

  // Run Sweep
  async runSweep(
    sessionId: string,
    layerName: string,
    interventionType: InterventionType,
    strengths: number[]
  ): Promise<SweepResult> {
    if (FORCE_MOCKS || sessionId.startsWith('demo_')) {
      await new Promise((r) => setTimeout(r, 400))
      return createMockSweepResult(
        layerName,
        interventionType === 'masking' ? 'masking' : 'noise'
      )
    }

    const res = await client.post('/api/intervention/sweep', {
      session_id: sessionId,
      layer_name: layerName,
      intervention_type: mapInterventionTypeToBackend(interventionType),
      strengths: strengths
    })

    const data = res.data
    const steps: any[] = data.results || data.steps || []

    return {
      layerName: data.layer || layerName,
      interventionType,
      strengths: steps.length ? steps.map((s) => Number(s.strength ?? 0)) : strengths,
      mseValues: steps.map((s) => Number(s.intervened_mse ?? s.mse_intervened ?? 0)),
      l2Norms: steps.map((s) => Number(s.intervened_l2 ?? s.relative_l2 ?? 0)),
      maxDivergences: steps.map((s) => {
        if (s.max_divergence !== undefined && s.max_divergence !== null) {
          return Number(s.max_divergence)
        }
        if (Array.isArray(s.trajectory_baseline) && Array.isArray(s.trajectory_intervened)) {
          let m = 0
          for (let i = 0; i < s.trajectory_baseline.length; i++) {
            const d = Math.abs((s.trajectory_intervened[i] ?? 0) - (s.trajectory_baseline[i] ?? 0))
            if (d > m) m = d
          }
          return m
        }
        return Number(s.trajectory_mean_deviation ?? s.mse_delta ?? 0)
      })
    }
  },

  // Full Analysis
  async runFullAnalysis(sessionId: string): Promise<FullAnalysisResult> {
    if (FORCE_MOCKS || sessionId.startsWith('demo_')) {
      return mockFullAnalysis
    }

    const res = await client.post('/api/intervention/full-analysis', {
      session_id: sessionId
    })
    const data = res.data
    const rawSens = data.sensitivity || data.sensitivities || {}

    const sensitivity: SensitivityItem[] = Array.isArray(rawSens)
      ? rawSens.map((s: any) => ({
          parameter: s.parameter || s.symbol || 'param',
          label: s.label || s.parameter || 'Parameter',
          gradSign: s.grad_sign || s.computed_sign || '~0',
          expectedSign: s.expected_sign || '~',
          consistent: Boolean(s.consistent ?? true),
          magnitude: Math.abs(Number(s.gradient ?? s.magnitude ?? 0)),
          description: s.trend || s.description || ''
        }))
      : Object.entries(rawSens).map(([sym, s]: [string, any]) => ({
          parameter: s.symbol || sym,
          label: s.label || sym,
          gradSign: s.computed_sign || s.grad_sign || '~0',
          expectedSign: s.expected_sign || '~',
          consistent: Boolean(s.consistent ?? true),
          magnitude: Math.abs(Number(s.gradient ?? s.magnitude ?? 0)),
          description: s.trend || s.description || ''
        }))

    return {
      l2NormBaseline: Number(data.l2_norm ?? data.relative_l2_baseline ?? 0),
      physicsResidualNorm: Number(data.physics_residual_norm ?? 0),
      sensitivity,
      timestamp: new Date().toISOString()
    }
  },

  // Node Mapping
  async runMapping(sessionId: string, sensitivityMethod = 'gradient'): Promise<NodeLayerMapping[]> {
    if (FORCE_MOCKS || sessionId.startsWith('demo_')) {
      return mockMappingList
    }

    const res = await client.post('/api/intervention/map', {
      session_id: sessionId,
      sensitivity_method: sensitivityMethod
    })

    const rawMap = res.data.mapping || res.data.mappings || {}
    const confidenceToScore: Record<string, number> = {
      High: 0.95,
      Medium: 0.65,
      Ambiguous: 0.45,
      Low: 0.2
    }

    if (Array.isArray(rawMap)) {
      return rawMap.map((m: any) => {
        const score = typeof m.score === 'number' ? m.score : (confidenceToScore[m.confidence] ?? 0.5)
        return {
          nodeId: m.node_id || m.nodeId || 'node',
          nodeLabel: m.node_label || m.nodeLabel || m.node_id || 'Node',
          nodeSymbol: m.node_symbol || m.symbol || m.node_id || '',
          mappedLayer: m.layer || m.mapped_layer || 'unmapped',
          confidence: score,
          alignmentPct: score * 100,
          strategy: m.strategy || m.scoring_mode || 'gradient-sensitivity'
        }
      })
    }

    return Object.entries(rawMap).map(([nodeLabel, m]: [string, any]) => {
      const score =
        typeof m.score === 'number' && !Number.isNaN(m.score)
          ? Math.min(1, Math.max(0, Math.abs(m.score)))
          : (confidenceToScore[m.confidence] ?? 0.5)

      return {
        nodeId: m.node_id || nodeLabel,
        nodeLabel: nodeLabel,
        nodeSymbol: m.symbol || nodeLabel,
        mappedLayer: m.layer || m.mapped_layer || 'unmapped',
        confidence: score,
        alignmentPct: score * 100,
        strategy: m.strategy || m.scoring_mode || 'Sensitivity (Gradient)'
      }
    })
  },

  // Route AI Physics Assistant queries through OpenRouter (`openrouter/free`) via backend
  async askAssistant(params: {
    sessionId: string | null
    apiKey: string
    message: string
    history: { role: 'user' | 'assistant'; content: string }[]
    context: Record<string, any>
  }): Promise<{ reply: string; model: string }> {
    const cleanKey = params.apiKey.trim()

    // 1. Primary path: route through backend `/api/assistant/chat`
    try {
      const res = await client.post('/api/assistant/chat', {
        session_id: params.sessionId,
        api_key: cleanKey,
        message: params.message,
        history: params.history,
        context: params.context
      })
      if (res.data?.reply) {
        return {
          reply: res.data.reply,
          model: res.data.model || 'openrouter/free'
        }
      }
    } catch (backendErr: any) {
      // If backend returned a 400/500 with an explicit OpenRouter error and no key is available for fallback, surface or try direct
      const status = backendErr?.response?.status
      if (status && status !== 404 && !cleanKey) {
        throw backendErr
      }
    }

    // 2. If backend route is offline/not yet deployed on Colab, call OpenRouter (`openrouter/free`) directly if UI key is provided
    if (cleanKey) {
      const systemPrompt =
        'You are the AI Physics Assistant inside the GIIT (Graph-Based Inspection and Intervention Tool for SciML) workbench.\n' +
        'Use the active PINN session context below (governing PDE/ODE equation, causal graph nodes/edges, autograd sensitivity signs, node-to-layer mappings, and latest layer intervention metrics) to give concise, scientifically accurate answers.\n\n' +
        `ACTIVE WORKBENCH CONTEXT:\n${JSON.stringify(params.context, null, 2)}`

      const orRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openrouter/free',
          messages: [
            { role: 'system', content: systemPrompt },
            ...params.history.slice(-6),
            { role: 'user', content: params.message }
          ],
          temperature: 0.2,
          max_tokens: 1024
        },
        {
          headers: {
            Authorization: `Bearer ${cleanKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'GIIT SciML Intervention Workbench'
          },
          timeout: 60000
        }
      )

      const content = orRes.data?.choices?.[0]?.message?.content
      if (content) {
        return {
          reply: content,
          model: orRes.data?.model || 'openrouter/free'
        }
      }
    }

    throw new Error('OpenRouter request unavailable without API key or active backend.')
  }
}
