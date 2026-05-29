import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useTimelineStore } from '../stores/timeline-store'
import { useItemsStore } from '../stores/items-store'
import { useZoomStore } from '../stores/zoom-store'
import { useSelectionStore } from '@/shared/state/selection'
import { moveItems } from '../stores/actions/item-actions'
import { trimItemStart, trimItemEnd } from '../stores/actions/edit/trim-actions'
import {
  expandSelectionWithLinkedItems,
  expandItemIdsWithAttachedCaptions,
} from '../utils/linked-items'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import { getNavigatorResizeDragResult, getNavigatorThumbMetrics } from './timeline-navigator-utils'
import type { TimelineItem } from '@/types/timeline'

const ITEM_TYPE_COLOR: Record<TimelineItem['type'], string> = {
  video: 'rgba(59,130,246,0.75)',
  audio: 'rgba(34,197,94,0.75)',
  text: 'rgba(251,191,36,0.85)',
  image: 'rgba(168,85,247,0.75)',
  shape: 'rgba(249,115,22,0.75)',
  adjustment: 'rgba(148,163,184,0.60)',
  composition: 'rgba(20,184,166,0.75)',
  subtitle: 'rgba(251,191,36,0.70)',
}

const ROW_H = 10
const ROW_GAP = 1
const EDGE_W = 5

type ViewportDrag = 'thumb' | 'left' | 'right' | null

interface ClipDrag {
  action: 'move' | 'trim-start' | 'trim-end'
  /** The item that received the mousedown */
  primaryItemId: string
  /** For 'move': all items in the drag group. For trim: just [primaryItemId]. */
  itemIds: string[]
  startX: number
  /** Absolute from-frame at drag start, keyed by item id */
  startFromMap: Record<string, number>
  /** Primary item's duration — needed for trim preview */
  startDuration: number
}

interface TimelineNavigatorProps {
  actualDuration: number
  timelineWidth: number
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export function TimelineNavigator({
  actualDuration,
  timelineWidth,
  scrollContainerRef,
}: TimelineNavigatorProps) {
  const lanesRef = useRef<HTMLDivElement>(null)
  const vpDragRafRef = useRef<number | null>(null)
  const clipDragRafRef = useRef<number | null>(null)
  const vpLatestDeltaRef = useRef(0)
  const clipLatestDeltaRef = useRef(0)

  const fps = useTimelineStore((s) => s.fps)
  const setZoomImmediate = useZoomStore((s) => s.setZoomLevelImmediate)
  const scrollLeft = useTimelineViewportStore((s) => s.scrollLeft)
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth)
  const maxFrame = useItemsStore((s) => s.maxItemEndFrame)
  const allTracks = useItemsStore((s) => s.tracks)
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId)
  // Read main-timeline selection for passive visual highlight only (no writes)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)

  const [lanesWidth, setLanesWidth] = useState(0)
  const [vpDragTarget, setVpDragTarget] = useState<ViewportDrag>(null)
  const [vpDragStartX, setVpDragStartX] = useState(0)
  const [vpDragStartThumbLeft, setVpDragStartThumbLeft] = useState(0)
  const [vpDragStartThumbWidth, setVpDragStartThumbWidth] = useState(0)
  const [clipDrag, setClipDrag] = useState<ClipDrag | null>(null)
  const [clipPreviewDelta, setClipPreviewDelta] = useState(0)
  // Navigator-local selection — independent of main-timeline selection.
  // Used to build multi-item drag groups. Never written to the global selection store.
  const [navSelectedIds, setNavSelectedIds] = useState<Set<string>>(new Set())

  const visibleTracks = useMemo(
    () =>
      [...allTracks]
        .filter((t) => !(t as { isGroup?: boolean }).isGroup)
        .sort((a, b) => a.order - b.order),
    [allTracks],
  )

  const contentDuration = useMemo(() => {
    const furthestEndSeconds = maxFrame / fps
    return Math.max(actualDuration, furthestEndSeconds, 10)
  }, [actualDuration, fps, maxFrame])

  const rowCount = Math.max(1, visibleTracks.length)
  const lanesHeight = rowCount * ROW_H + (rowCount - 1) * ROW_GAP
  const framesPerPixel = lanesWidth > 0 ? (contentDuration * fps) / lanesWidth : 0

  const { maxScrollLeft, thumbWidth, thumbTravel, thumbLeft } = getNavigatorThumbMetrics({
    timelineWidth,
    viewportWidth,
    trackWidth: lanesWidth,
    scrollLeft,
  })

  const setScrollLeftOnContainer = useCallback(
    (next: number) => {
      const node = scrollContainerRef.current
      if (node) node.scrollLeft = next
    },
    [scrollContainerRef],
  )

  // ── viewport thumb handlers ──────────────────────────────────────────────────
  const handleVpMouseDown = useCallback(
    (event: React.MouseEvent, target: Exclude<ViewportDrag, null>) => {
      event.preventDefault()
      event.stopPropagation()
      setVpDragTarget(target)
      setVpDragStartX(event.clientX)
      setVpDragStartThumbLeft(thumbLeft)
      setVpDragStartThumbWidth(thumbWidth)
    },
    [thumbLeft, thumbWidth],
  )

  const handleStripClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (vpDragTarget || maxScrollLeft <= 0 || thumbTravel <= 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const desiredLeft = Math.max(0, Math.min(thumbTravel, clickX - thumbWidth / 2))
      setScrollLeftOnContainer((desiredLeft / thumbTravel) * maxScrollLeft)
    },
    [vpDragTarget, maxScrollLeft, setScrollLeftOnContainer, thumbTravel, thumbWidth],
  )

  // ── clip handlers ────────────────────────────────────────────────────────────
  const handleClipMouseDown = useCallback(
    (event: React.MouseEvent, item: TimelineItem, action: ClipDrag['action']) => {
      event.preventDefault()
      event.stopPropagation()

      let nextSelected: Set<string>
      let dragIds: string[]

      if (action !== 'move') {
        // Trim handles always act on only the primary item — don't touch selection
        nextSelected = navSelectedIds
        dragIds = [item.id]
      } else if (event.metaKey || event.ctrlKey) {
        // ⌘/Ctrl + click: toggle this item in the navigator selection
        nextSelected = new Set(navSelectedIds)
        if (nextSelected.has(item.id)) {
          nextSelected.delete(item.id)
          // Never leave the set empty — keep the clicked item selected
          if (nextSelected.size === 0) nextSelected.add(item.id)
        } else {
          nextSelected.add(item.id)
        }
        dragIds = Array.from(nextSelected)
      } else if (navSelectedIds.has(item.id) && navSelectedIds.size > 1) {
        // Clicking an already-selected item inside a multi-select group:
        // keep the whole group so the user can immediately drag them together
        nextSelected = navSelectedIds
        dragIds = Array.from(nextSelected)
      } else {
        // Plain click on an unselected (or sole) item: replace selection
        nextSelected = new Set([item.id])
        dragIds = [item.id]
      }

      setNavSelectedIds(nextSelected)

      // Snapshot each item's current from-frame from the live store
      const allItems = useTimelineStore.getState().items
      const startFromMap: Record<string, number> = {}
      for (const id of dragIds) {
        const found = allItems.find((i) => i.id === id)
        if (found) startFromMap[id] = found.from
      }

      // Reset stale delta so the preview starts clean (no leftover from previous drag)
      clipLatestDeltaRef.current = 0

      setClipDrag({
        action,
        primaryItemId: item.id,
        itemIds: dragIds,
        startX: event.clientX,
        startFromMap,
        startDuration: item.durationInFrames,
      })
      setClipPreviewDelta(0)
    },
    [navSelectedIds],
  )

  // Clicking empty lane space clears navigator selection
  const handleLanesMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      setNavSelectedIds(new Set())
    }
  }, [])

  // ── ResizeObserver ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = lanesRef.current
    if (!el) return
    setLanesWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver((entries) => {
      const e = entries[0]
      if (e) setLanesWidth(e.contentRect.width)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── viewport drag window listeners ───────────────────────────────────────────
  useEffect(() => {
    if (!vpDragTarget) return

    const flush = () => {
      vpDragRafRef.current = null
      const el = lanesRef.current
      if (!el) return
      const w = el.clientWidth
      if (w <= 0) return
      const deltaX = vpLatestDeltaRef.current

      if (vpDragTarget === 'thumb') {
        if (thumbTravel <= 0 || maxScrollLeft <= 0) return
        const nextLeft = Math.max(0, Math.min(thumbTravel, vpDragStartThumbLeft + deltaX))
        setScrollLeftOnContainer((nextLeft / thumbTravel) * maxScrollLeft)
        return
      }

      if (contentDuration <= 0) return
      const { nextZoom, nextScrollLeft } = getNavigatorResizeDragResult({
        dragTarget: vpDragTarget,
        deltaX,
        dragStartThumbLeft: vpDragStartThumbLeft,
        dragStartThumbWidth: vpDragStartThumbWidth,
        trackWidth: w,
        viewportWidth,
        contentDuration,
      })
      setZoomImmediate(nextZoom)
      setScrollLeftOnContainer(nextScrollLeft)
    }

    const onMove = (e: MouseEvent) => {
      vpLatestDeltaRef.current = e.clientX - vpDragStartX
      if (vpDragRafRef.current !== null) return
      vpDragRafRef.current = requestAnimationFrame(flush)
    }
    const onUp = () => setVpDragTarget(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (vpDragRafRef.current !== null) {
        cancelAnimationFrame(vpDragRafRef.current)
        vpDragRafRef.current = null
      }
    }
  }, [
    vpDragTarget,
    vpDragStartX,
    vpDragStartThumbLeft,
    vpDragStartThumbWidth,
    maxScrollLeft,
    thumbTravel,
    viewportWidth,
    contentDuration,
    setZoomImmediate,
    setScrollLeftOnContainer,
  ])

  // ── clip drag window listeners ───────────────────────────────────────────────
  useEffect(() => {
    if (!clipDrag || framesPerPixel <= 0) return

    const flush = () => {
      clipDragRafRef.current = null
      setClipPreviewDelta(clipLatestDeltaRef.current)
    }
    const onMove = (e: MouseEvent) => {
      clipLatestDeltaRef.current = e.clientX - clipDrag.startX
      if (clipDragRafRef.current !== null) return
      clipDragRafRef.current = requestAnimationFrame(flush)
    }
    const onUp = () => {
      const deltaX = clipLatestDeltaRef.current
      const deltaFrames = Math.round(deltaX * framesPerPixel)
      if (deltaFrames !== 0) {
        if (clipDrag.action === 'move') {
          const linkedEnabled = useEditorStore.getState().linkedSelectionEnabled
          const allItems = useTimelineStore.getState().items
          // Expand to include linked A/V partners and attached captions
          const baseIds = Object.keys(clipDrag.startFromMap)
          const expandedIds = linkedEnabled
            ? expandItemIdsWithAttachedCaptions(
                allItems,
                expandSelectionWithLinkedItems(allItems, baseIds),
              )
            : baseIds
          // Single batch move — one undo entry, handles transition repair
          const updates = expandedIds.map((id) => {
            const startFrom =
              clipDrag.startFromMap[id] ?? allItems.find((i) => i.id === id)?.from ?? 0
            return { id, from: Math.max(0, startFrom + deltaFrames) }
          })
          moveItems(updates)
        } else if (clipDrag.action === 'trim-start') {
          trimItemStart(clipDrag.primaryItemId, deltaFrames)
        } else if (clipDrag.action === 'trim-end') {
          trimItemEnd(clipDrag.primaryItemId, deltaFrames)
        }
      }
      setClipDrag(null)
      setClipPreviewDelta(0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (clipDragRafRef.current !== null) {
        cancelAnimationFrame(clipDragRafRef.current)
        clipDragRafRef.current = null
      }
    }
  }, [clipDrag, framesPerPixel])

  useEffect(
    () => () => {
      if (vpDragRafRef.current !== null) cancelAnimationFrame(vpDragRafRef.current)
      if (clipDragRafRef.current !== null) cancelAnimationFrame(clipDragRafRef.current)
    },
    [],
  )

  // Items selected in the main timeline (passive visual hint — no interaction)
  const mainSelectedSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])

  // Set of item IDs currently being dragged — for O(1) preview lookup
  const draggingSet = useMemo(() => (clipDrag ? new Set(clipDrag.itemIds) : null), [clipDrag])

  return (
    <>
      <div className="bg-background/80 px-2 pt-2 pb-1.5 select-none">
        {/* ── clip lanes ── */}
        <div
          ref={lanesRef}
          className="relative rounded-sm overflow-hidden"
          style={{ height: lanesHeight }}
          onMouseDown={handleLanesMouseDown}
        >
          {visibleTracks.map((track, i) => {
            const trackItems = itemsByTrackId[track.id] ?? []
            const rowTop = i * (ROW_H + ROW_GAP)
            return (
              <div
                key={track.id}
                className="absolute left-0 right-0"
                style={{ top: rowTop, height: ROW_H, backgroundColor: 'rgba(255,255,255,0.04)' }}
              >
                {lanesWidth > 0 &&
                  contentDuration > 0 &&
                  trackItems.map((item) => {
                    // ── preview position during drag ──
                    let from = item.from
                    let duration = item.durationInFrames
                    if (clipDrag) {
                      const df = Math.round(clipPreviewDelta * framesPerPixel)
                      if (clipDrag.action === 'move' && draggingSet?.has(item.id)) {
                        from = Math.max(0, (clipDrag.startFromMap[item.id] ?? item.from) + df)
                      } else if (clipDrag.primaryItemId === item.id) {
                        if (clipDrag.action === 'trim-start') {
                          from = (clipDrag.startFromMap[item.id] ?? item.from) + df
                          duration = clipDrag.startDuration - df
                        } else if (clipDrag.action === 'trim-end') {
                          duration = clipDrag.startDuration + df
                        }
                      }
                    }

                    const left = (from / fps / contentDuration) * lanesWidth
                    const width = Math.max(
                      2,
                      (Math.max(0, duration) / fps / contentDuration) * lanesWidth,
                    )
                    const isDragging = draggingSet?.has(item.id) ?? false
                    // Navigator-local selection (bright white ring — indicates drag group)
                    const isNavSelected = navSelectedIds.has(item.id)
                    // Main-timeline selection (subtle primary ring — passive context only)
                    const isMainSelected = !isNavSelected && mainSelectedSet.has(item.id)
                    const showEdges = width > EDGE_W * 2 + 4

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'absolute top-0 h-full rounded-[1px] group',
                          isDragging ? 'cursor-grabbing' : 'cursor-grab',
                          isNavSelected && 'ring-1 ring-white/80 ring-inset',
                          isMainSelected && 'ring-1 ring-primary/50 ring-inset',
                        )}
                        style={{
                          left,
                          width: width - 1,
                          backgroundColor: ITEM_TYPE_COLOR[item.type],
                          opacity: isDragging ? 0.65 : 1,
                          zIndex: isDragging ? 20 : isNavSelected ? 10 : isMainSelected ? 5 : 1,
                          transition: isDragging ? undefined : 'opacity 100ms',
                        }}
                        onMouseDown={(e) => handleClipMouseDown(e, item, 'move')}
                      >
                        {showEdges && (
                          <div
                            className="absolute left-0 top-0 h-full cursor-ew-resize hover:bg-white/30 rounded-l-[1px]"
                            style={{ width: EDGE_W }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              handleClipMouseDown(e, item, 'trim-start')
                            }}
                          />
                        )}
                        {showEdges && (
                          <div
                            className="absolute right-0 top-0 h-full cursor-ew-resize hover:bg-white/30 rounded-r-[1px]"
                            style={{ width: EDGE_W }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              handleClipMouseDown(e, item, 'trim-end')
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>

        {/* ── viewport scrollbar strip ── */}
        <div
          className="relative mt-1.5 rounded-full cursor-pointer"
          style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.08)' }}
          onClick={handleStripClick}
        >
          {/* dimmed background */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
          />

          {/* thumb: bright pill showing the visible viewport window */}
          <div
            className={cn(
              'absolute top-0 h-full rounded-full flex items-center',
              vpDragTarget === 'thumb' ? 'cursor-grabbing' : 'cursor-grab',
            )}
            style={{
              left: thumbLeft,
              width: thumbWidth,
              backgroundColor: vpDragTarget ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.38)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.5)',
              transition: 'background-color 120ms',
            }}
            onMouseDown={(e) => handleVpMouseDown(e, 'thumb')}
            onClick={(e) => e.stopPropagation()}
          >
            {/* left zoom handle */}
            <div
              className="absolute left-0 top-0 h-full flex items-center justify-center cursor-ew-resize rounded-l-full"
              style={{ width: 12, backgroundColor: 'rgba(0,0,0,0.25)' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                handleVpMouseDown(e, 'left')
              }}
            >
              <div className="w-px h-3.5 rounded-full bg-white/70" />
            </div>

            {/* right zoom handle */}
            <div
              className="absolute right-0 top-0 h-full flex items-center justify-center cursor-ew-resize rounded-r-full"
              style={{ width: 12, backgroundColor: 'rgba(0,0,0,0.25)' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                handleVpMouseDown(e, 'right')
              }}
            >
              <div className="w-px h-3.5 rounded-full bg-white/70" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
