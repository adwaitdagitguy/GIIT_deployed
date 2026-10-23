import React from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { TrajectoryPlot } from './TrajectoryPlot'
import { MetricsPanel } from './MetricsPanel'
import { SensitivityTable } from './SensitivityTable'
import { MappingTable } from './MappingTable'
import { SweepPlot } from './SweepPlot'
import { AssistantChat } from './AssistantChat'
import {
  Activity,
  BarChart2,
  Gauge,
  Network,
  LineChart,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2
} from 'lucide-react'

interface AnalyticsDockProps {
  height: number
}

export const AnalyticsDock: React.FC<AnalyticsDockProps> = ({ height }) => {
  const {
    activeAnalyticsTab,
    setActiveAnalyticsTab,
    interventionResult,
    sweepResult,
    selectedLayer,
    interventionType,
    interventionStrength,
    isBottomDockOpen,
    setBottomDockOpen,
    isBottomDockMaximized,
    setBottomDockMaximized
  } = useWorkbenchStore()

  const tabs: Array<{
    id: string
    label: string
    icon: typeof Activity
    badge?: string
  }> = [
    { id: 'trajectory', label: 'Trajectory Comparison', icon: Activity, badge: interventionResult ? 'Live' : undefined },
    { id: 'metrics', label: 'Error & Loss Metrics', icon: BarChart2 },
    { id: 'sensitivity', label: 'Physics Sensitivity', icon: Gauge },
    { id: 'mapping', label: 'Node → Layer Mapping', icon: Network },
    { id: 'sweep', label: 'Parameter Sweep Curve', icon: LineChart, badge: sweepResult ? 'Done' : undefined },
    { id: 'assistant', label: 'AI Physics Assistant', icon: Sparkles }
  ]

  const effectiveHeight = !isBottomDockOpen ? 40 : isBottomDockMaximized ? Math.max(height, 500) : height

  return (
    <div
      style={{ height: `${effectiveHeight}px` }}
      className="bg-slate-900/90 border-t border-slate-800 flex flex-col select-none backdrop-blur-md shadow-2xl z-20 transition-[height] duration-75"
    >
      {/* Tab Navigation Header */}
      <div className="h-10 shrink-0 bg-slate-950/80 border-b border-slate-800/90 px-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeAnalyticsTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveAnalyticsTab(tab.id as any)
                  if (!isBottomDockOpen) setBottomDockOpen(true)
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive && isBottomDockOpen
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive && isBottomDockOpen ? 'text-cyan-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-500/30">
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Right Info Pill + Collapse / Maximize Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400 font-mono mr-1">
            <span>Target: <strong className="text-slate-200">{selectedLayer || '—'}</strong></span>
            <span>•</span>
            <span>Method: <strong className="text-amber-300 capitalize">{interventionType}</strong></span>
          </div>

          <button
            onClick={() => setBottomDockMaximized(!isBottomDockMaximized)}
            className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors cursor-pointer"
            title={isBottomDockMaximized ? "Restore Analytics Dock Size" : "Maximize Analytics Dock"}
          >
            {isBottomDockMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            onClick={() => setBottomDockOpen(!isBottomDockOpen)}
            className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded transition-colors cursor-pointer"
            title={isBottomDockOpen ? "Collapse Analytics Dock" : "Expand Analytics Dock"}
          >
            {isBottomDockOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Tab Content Body */}
      {isBottomDockOpen && (
        <div className="flex-1 min-h-0 overflow-hidden bg-slate-950/50">
          {activeAnalyticsTab === 'trajectory' && (
            <TrajectoryPlot
              data={interventionResult ? interventionResult.trajectory : null}
              layerName={selectedLayer}
              interventionType={interventionType}
              strength={interventionStrength}
            />
          )}
          {activeAnalyticsTab === 'metrics' && (
            <MetricsPanel metrics={interventionResult ? interventionResult.metrics : null} />
          )}
          {activeAnalyticsTab === 'sensitivity' && <SensitivityTable />}
          {activeAnalyticsTab === 'mapping' && <MappingTable />}
          {activeAnalyticsTab === 'sweep' && <SweepPlot data={sweepResult} />}
          {activeAnalyticsTab === 'assistant' && <AssistantChat />}
        </div>
      )}
    </div>
  )
}
