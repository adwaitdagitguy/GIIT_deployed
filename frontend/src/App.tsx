import React, { useState, useCallback, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { GraphCanvas } from './components/graph/GraphCanvas'
import { NodeInspector } from './components/inspector/NodeInspector'
import { InterventionControls } from './components/inspector/InterventionControls'
import { AnalyticsDock } from './components/analytics/AnalyticsDock'
import { GuidedTour } from './components/onboarding/GuidedTour'
import { useWorkbenchStore } from './store/workbenchStore'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})

export const App: React.FC = () => {
  const {
    isLeftPanelOpen,
    setLeftPanelOpen,
    isRightPanelOpen,
    setRightPanelOpen,
    isBottomDockOpen,
    setBottomDockOpen,
    isBottomDockMaximized,
    setBottomDockMaximized
  } = useWorkbenchStore()

  // Panel dimensions (in px)
  const [leftWidth, setLeftWidth] = useState(310)
  const [rightWidth, setRightWidth] = useState(360)
  const [bottomHeight, setBottomHeight] = useState(280)

  // Active drag state
  const [dragging, setDragging] = useState<'left' | 'right' | 'bottom' | null>(null)

  const startResize = useCallback(
    (panel: 'left' | 'right' | 'bottom') => (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(panel)
    },
    []
  )

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (dragging === 'left') {
        const nextWidth = Math.min(560, Math.max(180, e.clientX))
        if (e.clientX < 100) {
          setLeftPanelOpen(false)
          setDragging(null)
        } else {
          if (!isLeftPanelOpen) setLeftPanelOpen(true)
          setLeftWidth(nextWidth)
        }
      } else if (dragging === 'right') {
        const widthFromRight = window.innerWidth - e.clientX
        const nextWidth = Math.min(620, Math.max(220, widthFromRight))
        if (widthFromRight < 100) {
          setRightPanelOpen(false)
          setDragging(null)
        } else {
          if (!isRightPanelOpen) setRightPanelOpen(true)
          setRightWidth(nextWidth)
        }
      } else if (dragging === 'bottom') {
        const heightFromBottom = window.innerHeight - e.clientY
        if (heightFromBottom < 80) {
          setBottomDockOpen(false)
          setDragging(null)
        } else {
          if (!isBottomDockOpen) setBottomDockOpen(true)
          if (isBottomDockMaximized) setBottomDockMaximized(false)
          const maxAllowed = Math.floor(window.innerHeight * 0.78)
          const nextHeight = Math.min(maxAllowed, Math.max(130, heightFromBottom))
          setBottomHeight(nextHeight)
        }
      }
    }

    const handleMouseUp = () => {
      setDragging(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    dragging,
    isLeftPanelOpen,
    isRightPanelOpen,
    isBottomDockOpen,
    isBottomDockMaximized,
    setLeftPanelOpen,
    setRightPanelOpen,
    setBottomDockOpen,
    setBottomDockMaximized
  ])

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className={`flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none ${
          dragging === 'left' || dragging === 'right'
            ? 'cursor-col-resize'
            : dragging === 'bottom'
            ? 'cursor-row-resize'
            : ''
        }`}
      >
        {/* Top Header Navigation */}
        <TopBar />

        {/* Main 3-Column Studio Workspace */}
        <main className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Left Panel: Model & Ruleset Uploader */}
          {isLeftPanelOpen ? (
            <>
              <div style={{ width: `${leftWidth}px` }} className="h-full shrink-0 overflow-hidden">
                <Sidebar />
              </div>

              {/* Left Vertical Resize Handle */}
              <div
                onMouseDown={startResize('left')}
                onDoubleClick={() => setLeftPanelOpen(false)}
                title="Drag to resize left panel (double-click to hide)"
                className={`w-1.5 h-full shrink-0 cursor-col-resize flex items-center justify-center transition-colors z-20 group ${
                  dragging === 'left'
                    ? 'bg-cyan-500/60'
                    : 'bg-slate-800/80 hover:bg-cyan-500/50'
                }`}
              >
                <div className="w-0.5 h-8 rounded-full bg-slate-600 group-hover:bg-cyan-300 transition-colors" />
              </div>
            </>
          ) : (
            /* Floating Left Restore Tab */
            <button
              onClick={() => setLeftPanelOpen(true)}
              className="absolute top-14 left-2 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border border-slate-700/90 shadow-lg backdrop-blur-md text-xs font-semibold transition-all cursor-pointer"
              title="Open Model & Ruleset Sidebar"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Model</span>
            </button>
          )}

          {/* Center Pane: React Flow Causal Physics Graph */}
          <div className="flex-1 h-full min-w-0 relative">
            <GraphCanvas />
          </div>

          {/* Right Panel: Node Inspector & Intervention Studio */}
          {isRightPanelOpen ? (
            <>
              {/* Right Vertical Resize Handle */}
              <div
                onMouseDown={startResize('right')}
                onDoubleClick={() => setRightPanelOpen(false)}
                title="Drag to resize right panel (double-click to hide)"
                className={`w-1.5 h-full shrink-0 cursor-col-resize flex items-center justify-center transition-colors z-20 group ${
                  dragging === 'right'
                    ? 'bg-cyan-500/60'
                    : 'bg-slate-800/80 hover:bg-cyan-500/50'
                }`}
              >
                <div className="w-0.5 h-8 rounded-full bg-slate-600 group-hover:bg-cyan-300 transition-colors" />
              </div>

              <aside
                style={{ width: `${rightWidth}px` }}
                className="h-full shrink-0 bg-slate-900/60 flex flex-col divide-y divide-slate-800 overflow-y-auto z-10"
              >
                <NodeInspector />
                <InterventionControls />
              </aside>
            </>
          ) : (
            /* Floating Right Restore Tab */
            <button
              onClick={() => setRightPanelOpen(true)}
              className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-amber-400 border border-slate-700/90 shadow-lg backdrop-blur-md text-xs font-semibold transition-all cursor-pointer"
              title="Open Node Inspector & Intervention Studio"
            >
              <span className="hidden sm:inline">Inspector</span>
              <PanelRightOpen className="w-3.5 h-3.5" />
            </button>
          )}
        </main>

        {/* Horizontal Resize Handle above Bottom Analytics Dock */}
        <div
          onMouseDown={startResize('bottom')}
          onDoubleClick={() => setBottomDockOpen(!isBottomDockOpen)}
          title="Drag to resize bottom analytics dock (double-click to toggle)"
          className={`h-1.5 w-full shrink-0 cursor-row-resize flex items-center justify-center transition-colors z-30 group ${
            dragging === 'bottom'
              ? 'bg-cyan-500/60'
              : 'bg-slate-800/80 hover:bg-cyan-500/50'
          }`}
        >
          <div className="w-10 h-0.5 rounded-full bg-slate-600 group-hover:bg-cyan-300 transition-colors" />
        </div>

        {/* Bottom Panel: Multi-Tab Analytics Dock */}
        <AnalyticsDock height={bottomHeight} />

        {/* Interactive Guided Tour Modal */}
        <GuidedTour />
      </div>
    </QueryClientProvider>
  )
}

export default App
