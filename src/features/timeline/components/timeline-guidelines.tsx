import { useCallback, useEffect, useRef } from 'react'
import { useSelectionStore } from '@/shared/state/selection'
import type { SnapTarget } from '../types/drag'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'

/**
 * Timeline Guidelines Component
 *
 * Renders two types of vertical indicators:
 * 1. Snap guideline — green/primary line when magnetically snapping during drag
 * 2. Insert blade  — bright green blade + badge when ⌘-dragging in insert mode
 */
export function TimelineGuidelines() {
  const { frameToPixels } = useTimelineZoomContext()
  const snapContainerRef = useRef<HTMLDivElement>(null)
  const snapLineRef = useRef<HTMLDivElement>(null)
  const insertContainerRef = useRef<HTMLDivElement>(null)
  const insertLineRef = useRef<HTMLDivElement>(null)
  const activeSnapTargetRef = useRef<SnapTarget | null>(
    useSelectionStore.getState().activeSnapTarget,
  )
  const insertIndicatorFrameRef = useRef<number | null>(
    useSelectionStore.getState().insertIndicatorFrame,
  )

  const syncSnapGuideline = useCallback(
    (activeSnapTarget: SnapTarget | null) => {
      const container = snapContainerRef.current
      const line = snapLineRef.current
      if (!container || !line) return

      if (!activeSnapTarget) {
        container.style.display = 'none'
        return
      }

      const isMagnetic =
        activeSnapTarget.type === 'item-start' || activeSnapTarget.type === 'item-end'
      const isPlayhead = activeSnapTarget.type === 'playhead'
      if (!isMagnetic && !isPlayhead) {
        container.style.display = 'none'
        return
      }

      container.style.display = ''
      line.style.left = `${frameToPixels(activeSnapTarget.frame)}px`
    },
    [frameToPixels],
  )

  const syncInsertBlade = useCallback(
    (frame: number | null) => {
      const container = insertContainerRef.current
      const line = insertLineRef.current
      if (!container || !line) return

      if (frame === null) {
        container.style.display = 'none'
        return
      }

      container.style.display = ''
      line.style.left = `${frameToPixels(frame)}px`
    },
    [frameToPixels],
  )

  // Snap guideline subscription
  useEffect(() => {
    syncSnapGuideline(activeSnapTargetRef.current)

    return useSelectionStore.subscribe((state, previous) => {
      if (state.activeSnapTarget === previous.activeSnapTarget) return
      activeSnapTargetRef.current = state.activeSnapTarget
      syncSnapGuideline(state.activeSnapTarget)
    })
  }, [syncSnapGuideline])

  useEffect(() => {
    syncSnapGuideline(activeSnapTargetRef.current)
  }, [syncSnapGuideline])

  // Insert blade subscription
  useEffect(() => {
    syncInsertBlade(insertIndicatorFrameRef.current)

    return useSelectionStore.subscribe((state, previous) => {
      if (state.insertIndicatorFrame === previous.insertIndicatorFrame) return
      insertIndicatorFrameRef.current = state.insertIndicatorFrame
      syncInsertBlade(state.insertIndicatorFrame)
    })
  }, [syncInsertBlade])

  useEffect(() => {
    syncInsertBlade(insertIndicatorFrameRef.current)
  }, [syncInsertBlade])

  return (
    <>
      {/* Snap guideline */}
      <div
        ref={snapContainerRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 10000, display: 'none' }}
      >
        <div
          ref={snapLineRef}
          className="absolute top-0 bottom-0 w-px"
          style={{
            backgroundColor: 'var(--color-timeline-snap)',
            opacity: 0.9,
            boxShadow: '0 0 4px var(--color-timeline-snap)',
          }}
        />
      </div>

      {/* Insert mode blade */}
      <div
        ref={insertContainerRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 10001, display: 'none' }}
      >
        <div
          ref={insertLineRef}
          className="absolute top-0 bottom-0"
          style={{
            width: 2,
            backgroundColor: 'rgb(34,197,94)',
            boxShadow: '0 0 6px rgba(34,197,94,0.8)',
          }}
        >
          {/* INSERT badge at top */}
          <div
            className="absolute top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide"
            style={{ backgroundColor: 'rgb(34,197,94)', color: '#000' }}
          >
            INSERT
          </div>
        </div>
      </div>
    </>
  )
}
