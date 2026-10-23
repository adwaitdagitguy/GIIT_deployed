import React, { useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { api } from '../../services/api'
import { Send, Bot, User, KeyRound, Sparkles, Loader2 } from 'lucide-react'

export const AssistantChat: React.FC = () => {
  const {
    sessionId,
    chatMessages,
    addChatMessage,
    graph,
    modelMetadata,
    fullAnalysis,
    mapping,
    interventionResult,
    selectedLayer,
    openRouterApiKey,
    setOpenRouterApiKey
  } = useWorkbenchStore()
  const [input, setInput] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [showKeyInput, setShowKeyInput] = useState(!openRouterApiKey)

  const buildDynamicReply = (query: string): string => {
    if (!modelMetadata || !graph) {
      return "No PINN model is currently loaded. Please upload a model (.py), weights (.pt), and optional graph (.json) in the left sidebar—or load the Demo Model—to query live equations, sensitivities, and layer mappings."
    }

    const q = query.toLowerCase()
    const sysName = graph.metadata.system || modelMetadata.modelClass
    const eq = graph.metadata.equation || "N/A"
    const nodes = graph.nodes || []
    const paramNodes = nodes.filter((n) => n.type === "parameter")

    // Check if the user asked about a specific node or parameter in the loaded graph
    const matchedNode = nodes.find(
      (n) =>
        q.includes(n.label.toLowerCase()) ||
        (n.symbol && n.symbol.length > 1 && q.includes(n.symbol.toLowerCase())) ||
        (n.id && n.id.length > 1 && q.includes(n.id.toLowerCase()))
    )

    if (matchedNode) {
      const mappedEntry = mapping?.find(
        (m) =>
          m.nodeId === matchedNode.id ||
          m.nodeLabel.toLowerCase() === matchedNode.label.toLowerCase()
      )
      const sensEntry = fullAnalysis?.sensitivity?.find(
        (s) =>
          s.parameter.toLowerCase() === matchedNode.id.toLowerCase() ||
          s.label.toLowerCase() === matchedNode.label.toLowerCase()
      )

      const parts: string[] = [
        `**${matchedNode.label} (${matchedNode.symbol})** is a ${matchedNode.type} node in **${sysName}**.`
      ]
      if (matchedNode.description) parts.push(matchedNode.description)
      if (matchedNode.default_value !== undefined) {
        parts.push(`Default value: ${matchedNode.default_value}${matchedNode.unit ? ` ${matchedNode.unit}` : ''}.`)
      }
      if (matchedNode.trend) parts.push(`Expected trend: ${matchedNode.trend}`)
      if (sensEntry) {
        parts.push(
          `Autograd sensitivity: sign [${sensEntry.gradSign}] vs expected [${sensEntry.expectedSign}] (|∇| = ${sensEntry.magnitude.toExponential(3)}, ${sensEntry.consistent ? 'physically consistent' : 'sign violation'}).`
        )
      }
      if (mappedEntry) {
        parts.push(
          `Mapped neural component: '${mappedEntry.mappedLayer}' (${mappedEntry.alignmentPct.toFixed(1)}% alignment via ${mappedEntry.strategy}).`
        )
      }
      return parts.join(" ")
    }

    if (q.includes("map") || q.includes("layer") || q.includes("weight")) {
      if (mapping && mapping.length > 0) {
        const summary = mapping
          .map((m) => `${m.nodeLabel} (${m.nodeSymbol}) → ${m.mappedLayer} (${m.alignmentPct.toFixed(0)}%)`)
          .join("; ")
        return `In **${sysName}**, automated node-to-layer discovery mapped: ${summary}. Currently selected target tensor: '${selectedLayer}'.`
      }
      return `The loaded model **${modelMetadata.modelClass}** has ${modelMetadata.perturbableTensors.length} perturbable tensors (${modelMetadata.perturbableTensors.slice(0, 4).join(", ")}${modelMetadata.perturbableTensors.length > 4 ? ", ..." : ""}). Open the 'Node → Layer Mapping' tab and click 'Run Systematic Layer Mapping' to compute mappings.`
    }

    if (q.includes("loss") || q.includes("residual") || q.includes("error") || q.includes("l2") || q.includes("mse")) {
      const resStr = fullAnalysis
        ? `Physics residual norm = ${fullAnalysis.physicsResidualNorm.toExponential(4)}, Baseline relative L2 = ${(fullAnalysis.l2NormBaseline * 100).toFixed(3)}%.`
        : "Run 'Sensitivity Analysis' in the Physics Sensitivity tab to compute the exact PDE/ODE residual norm."
      const intStr = interventionResult
        ? ` Under the current intervention (${interventionResult.interventionType} @ α=${interventionResult.strength} on '${interventionResult.layerName}'), MSE is ${interventionResult.metrics.mseIntervened.toExponential(3)} and max trajectory divergence is ${interventionResult.metrics.maxDivergence.toFixed(4)}.`
        : ""
      return `For **${sysName}** (${eq}): ${resStr}${intStr}`
    }

    if (q.includes("sensitivity") || q.includes("gradient") || q.includes("parameter") || q.includes("sign")) {
      if (fullAnalysis && fullAnalysis.sensitivity.length > 0) {
        const list = fullAnalysis.sensitivity
          .map(
            (s) =>
              `${s.label} (${s.parameter}): autograd [${s.gradSign}] vs expected [${s.expectedSign}] (${s.consistent ? 'Consistent' : 'Violation'})`
          )
          .join("; ")
        return `Autograd parameter sensitivities for **${sysName}**: ${list}.`
      }
      if (paramNodes.length > 0) {
        return `Physical parameters in **${sysName}**: ${paramNodes.map((p) => `${p.label} (${p.symbol}${p.default_value !== undefined ? ` = ${p.default_value}` : ''})`).join(", ")}. Switch to the 'Physics Sensitivity' tab to evaluate autograd gradients.`
      }
    }

    return `Active system: **${sysName}** governed by \`${eq}\`. Model class \`${modelMetadata.modelClass}\` contains ${modelMetadata.totalParameters} learnable parameters across ${modelMetadata.perturbableTensors.length} tensors, with ${nodes.length} causal graph nodes and ${graph.edges.length} directed edges.`
  }

  const buildActiveContext = () => ({
    system: graph?.metadata?.system || modelMetadata?.modelClass || 'No model loaded',
    equation: graph?.metadata?.equation || 'N/A',
    description: graph?.metadata?.description || '',
    modelClass: modelMetadata?.modelClass || null,
    totalParameters: modelMetadata?.totalParameters || 0,
    perturbableTensors: modelMetadata?.perturbableTensors || [],
    selectedLayer: selectedLayer || null,
    nodes: (graph?.nodes || []).map((n) => ({
      id: n.id,
      label: n.label,
      symbol: n.symbol,
      type: n.type,
      default_value: n.default_value,
      unit: n.unit,
      trend: n.trend
    })),
    sensitivity: fullAnalysis?.sensitivity || [],
    physicsResidualNorm: fullAnalysis?.physicsResidualNorm ?? null,
    l2NormBaseline: fullAnalysis?.l2NormBaseline ?? null,
    mapping: mapping || [],
    latestIntervention: interventionResult
      ? {
          layerName: interventionResult.layerName,
          interventionType: interventionResult.interventionType,
          strength: interventionResult.strength,
          metrics: interventionResult.metrics
        }
      : null
  })

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    const currentInput = input.trim()
    const userMsg = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: currentInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    addChatMessage(userMsg)
    setInput("")

    if (!openRouterApiKey.trim()) {
      const localReply = buildDynamicReply(currentInput)
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `${localReply}\n\n*(Local context fallback — enter your OpenRouter API key above to route queries through \`openrouter/free\`)*`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
      return
    }

    setIsSending(true)
    try {
      const historyPayload = chatMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      const { reply } = await api.askAssistant({
        sessionId,
        apiKey: openRouterApiKey,
        message: currentInput,
        history: historyPayload,
        context: buildActiveContext()
      })
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
    } catch (err: any) {
      console.warn("OpenRouter assistant fallback to local context:", err)
      const fallback = buildDynamicReply(currentInput)
      addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `${fallback}\n\n*(Offline fallback — OpenRouter request failed: ${err?.response?.data?.detail || err?.message || 'network error'})*`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="p-3 h-full flex flex-col justify-between select-none">
      {/* Router & API Key Header Bar */}
      <div className="pb-2 mb-2 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-[10px] font-mono text-cyan-300">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Router: openrouter/free
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${
              openRouterApiKey.trim()
                ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
            }`}
          >
            {openRouterApiKey.trim() ? 'API Key Active' : 'Local Fallback (No API Key)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-1 max-w-md justify-end">
          {showKeyInput || !openRouterApiKey.trim() ? (
            <div className="flex items-center gap-1.5 flex-1">
              <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="password"
                value={openRouterApiKey}
                onChange={(e) => setOpenRouterApiKey(e.target.value)}
                placeholder="Enter OpenRouter API Key (sk-or-v1-...)"
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              {openRouterApiKey.trim() && (
                <button
                  onClick={() => setShowKeyInput(false)}
                  className="px-2 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                >
                  Done
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowKeyInput(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 hover:text-cyan-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors cursor-pointer"
            >
              <KeyRound className="w-3 h-3" />
              Change API Key
            </button>
          )}
        </div>
      </div>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {chatMessages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2 text-xs ${
              m.role === 'user' ? 'flex-row-reverse' : ''
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              {m.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
            </div>
            <div
              className={`max-w-[80%] p-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
              }`}
            >
              {m.content}
              <div
                className={`text-[9px] mt-1 ${
                  m.role === 'user' ? 'text-blue-200' : 'text-slate-500'
                }`}
              >
                {m.timestamp}
              </div>
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex items-center gap-2 text-xs text-cyan-400 pl-1 py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Querying openrouter/free with active PINN context...</span>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="pt-2 flex gap-2">
        <input
          type="text"
          value={input}
          disabled={isSending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask about active system parameters, residuals, layer mappings, or interventions..."
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isSending || !input.trim()}
          className="p-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg hover:from-blue-500 hover:to-cyan-500 transition-all cursor-pointer disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
