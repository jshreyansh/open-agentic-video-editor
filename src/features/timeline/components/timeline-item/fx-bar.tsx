import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, Sparkles, Layers } from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Slider } from '@/components/ui/slider'
import { useKeyframesStore } from '../../stores/keyframes-store'
import { useTransitionsStore } from '../../stores/transitions-store'
import { removeKeyframes } from '../../stores/actions/keyframe-actions'
import { removeTransition } from '../../stores/actions/transition-actions'
import { addKeyframes } from '../../stores/actions/keyframe-actions'
import type { TimelineItem } from '@/types/timeline'
import type { KeyframeRef } from '@/types/keyframe'

// ── Zoom event detection ────────────────────────────────────────────────────

interface ZoomEvent {
  /** Absolute project frame where ramp-in begins */
  startFrame: number
  /** Absolute project frame of peak (start of hold) */
  peakFrame: number
  /** Absolute project frame where hold ends */
  holdEndFrame: number
  /** Absolute project frame where ramp-out ends */
  endFrame: number
  /** Zoom level multiplier (e.g. 1.35) */
  level: number
  /** Base pixel width (for re-adding after edit) */
  baseW: number
  /** Zoomed pixel width */
  zoomW: number
  /** Keyframe IDs for all 8 kfs (4 width + 4 height) — needed to delete/replace */
  widthKfIds: [string, string, string, string]
  heightKfIds: [string, string, string, string]
}

function parseZoomEvents(
  itemId: string,
  kfsByItemId: ReturnType<typeof useKeyframesStore.getState>['keyframesByItemId'],
): ZoomEvent[] {
  const itemKf = kfsByItemId[itemId]
  if (!itemKf) return []

  const widthProp = itemKf.properties.find((p) => p.property === 'width')
  const heightProp = itemKf.properties.find((p) => p.property === 'height')
  if (!widthProp || widthProp.keyframes.length < 4) return []

  const wKfs = [...widthProp.keyframes].sort((a, b) => a.frame - b.frame)
  const hKfs = heightProp ? [...heightProp.keyframes].sort((a, b) => a.frame - b.frame) : []

  const events: ZoomEvent[] = []
  for (let i = 0; i + 3 < wKfs.length; i += 4) {
    const [k0, k1, k2, k3] = [wKfs[i]!, wKfs[i + 1]!, wKfs[i + 2]!, wKfs[i + 3]!]
    if (k1.value <= k0.value) continue // not a zoom-up pattern
    const level = k0.value > 0 ? k1.value / k0.value : 1
    const hSlice = hKfs.slice(i, i + 4)
    events.push({
      startFrame: k0.frame,
      peakFrame: k1.frame,
      holdEndFrame: k2.frame,
      endFrame: k3.frame,
      level,
      baseW: k0.value,
      zoomW: k1.value,
      widthKfIds: [k0.id, k1.id, k2.id, k3.id],
      heightKfIds:
        hSlice.length === 4
          ? [hSlice[0]!.id, hSlice[1]!.id, hSlice[2]!.id, hSlice[3]!.id]
          : ['', '', '', ''],
    })
  }
  return events
}

// ── Transition indicator colors ─────────────────────────────────────────────

const TRANSITION_COLORS: Record<string, string> = {
  fade: 'rgba(99,179,237,0.55)',
  dissolve: 'rgba(154,205,250,0.55)',
  wipe: 'rgba(251,191,36,0.55)',
  slide: 'rgba(167,243,208,0.55)',
  flip: 'rgba(216,180,254,0.55)',
  sparkles: 'rgba(253,186,116,0.55)',
  glitch: 'rgba(248,113,113,0.55)',
  pixelate: 'rgba(134,239,172,0.55)',
  chromatic: 'rgba(192,132,252,0.55)',
}
function transitionColor(presentation: string) {
  return TRANSITION_COLORS[presentation] ?? 'rgba(148,163,184,0.5)'
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface ZoomSegmentProps {
  ev: ZoomEvent
  item: TimelineItem
  fps: number
}

const ZoomSegment = memo(function ZoomSegment({ ev, item, fps }: ZoomSegmentProps) {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState(Math.round((ev.level - 1) * 100))
  const ref = useRef<HTMLDivElement>(null)

  const clipDur = item.durationInFrames
  const leftPct = ((ev.startFrame - item.from) / clipDur) * 100
  const widthPct = ((ev.endFrame - ev.startFrame) / clipDur) * 100
  const rampPct = ((ev.peakFrame - ev.startFrame) / (ev.endFrame - ev.startFrame)) * 100
  const holdPct = ((ev.holdEndFrame - ev.peakFrame) / (ev.endFrame - ev.startFrame)) * 100

  const handleDelete = useCallback(() => {
    const refs: KeyframeRef[] = [
      ...ev.widthKfIds.map((id) => ({
        itemId: item.id,
        property: 'width' as const,
        keyframeId: id,
      })),
      ...ev.heightKfIds
        .filter(Boolean)
        .map((id) => ({ itemId: item.id, property: 'height' as const, keyframeId: id })),
    ]
    removeKeyframes(refs)
    setOpen(false)
  }, [ev, item.id])

  const handleUpdate = useCallback(() => {
    const newLevel = 1 + level / 100
    const ramp = ev.peakFrame - ev.startFrame
    const hold = ev.holdEndFrame - ev.peakFrame
    const newZoomW = Math.round(ev.baseW * newLevel)
    const baseH = ev.baseW > 0 && ev.zoomW > 0 ? ev.zoomW / ev.baseW : 1
    const newZoomH = Math.round(ev.baseW * baseH * newLevel) // approximate

    // Remove old keyframes then re-add with new values
    const refs: KeyframeRef[] = [
      ...ev.widthKfIds.map((id) => ({
        itemId: item.id,
        property: 'width' as const,
        keyframeId: id,
      })),
      ...ev.heightKfIds
        .filter(Boolean)
        .map((id) => ({ itemId: item.id, property: 'height' as const, keyframeId: id })),
    ]
    removeKeyframes(refs)

    addKeyframes([
      { itemId: item.id, property: 'width', frame: ev.startFrame, value: ev.baseW },
      { itemId: item.id, property: 'width', frame: ev.startFrame + ramp, value: newZoomW },
      { itemId: item.id, property: 'width', frame: ev.startFrame + ramp + hold, value: newZoomW },
      { itemId: item.id, property: 'width', frame: ev.endFrame, value: ev.baseW },
      {
        itemId: item.id,
        property: 'height',
        frame: ev.startFrame,
        value: Math.round((ev.baseW * 9) / 16),
      },
      { itemId: item.id, property: 'height', frame: ev.startFrame + ramp, value: newZoomH },
      { itemId: item.id, property: 'height', frame: ev.startFrame + ramp + hold, value: newZoomH },
      {
        itemId: item.id,
        property: 'height',
        frame: ev.endFrame,
        value: Math.round((ev.baseW * 9) / 16),
      },
    ])
    setOpen(false)
  }, [ev, item.id, level])

  const holdSec = (ev.holdEndFrame - ev.peakFrame) / fps
  const levelDisplay = (1 + level / 100).toFixed(2)

  return (
    <>
      <div
        ref={ref}
        className="absolute top-0 h-full cursor-pointer group"
        style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1)}%` }}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title={`Zoom ${ev.level.toFixed(2)}x · ${holdSec.toFixed(1)}s hold`}
      >
        {/* ramp-in (dimmer) */}
        <div
          className="absolute top-0 h-full"
          style={{
            left: 0,
            width: `${rampPct}%`,
            background: 'linear-gradient(to right, rgba(251,191,36,0.15), rgba(251,191,36,0.7))',
          }}
        />
        {/* hold (bright) */}
        <div
          className="absolute top-0 h-full"
          style={{
            left: `${rampPct}%`,
            width: `${holdPct}%`,
            backgroundColor: 'rgba(251,191,36,0.75)',
          }}
        />
        {/* ramp-out (dimmer) */}
        <div
          className="absolute top-0 h-full"
          style={{
            left: `${rampPct + holdPct}%`,
            right: 0,
            background: 'linear-gradient(to right, rgba(251,191,36,0.7), rgba(251,191,36,0.15))',
          }}
        />
        {/* Hover border */}
        <div className="absolute inset-0 ring-1 ring-amber-400/0 group-hover:ring-amber-400/80 transition-all rounded-[1px]" />
      </div>

      {/* Edit popover */}
      {open && (
        <FxPopover
          anchorRef={ref}
          title="Zoom Effect"
          icon={<ZoomIn className="h-3 w-3" />}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Level</span>
                <span className="font-mono text-foreground">{levelDisplay}×</span>
              </div>
              <Slider
                min={10}
                max={100}
                step={1}
                value={[level]}
                onValueChange={([v]) => setLevel(v ?? level)}
                className="h-1"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/60">
                <span>1.10×</span>
                <span>2.00×</span>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Hold <span className="text-foreground font-mono">{holdSec.toFixed(1)}s</span>
            </div>
            <div className="flex gap-1.5">
              <button
                className="flex-1 text-xs rounded px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleUpdate}
              >
                Update
              </button>
              <button
                className="text-xs rounded px-2 py-1 bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </FxPopover>
      )}
    </>
  )
})

// ── Transition Indicator ─────────────────────────────────────────────────────

interface TransitionOverlayProps {
  side: 'left' | 'right'
  transitionId: string
  presentation: string
  durationInFrames: number
  overlapFrames: number
  clipDurationFrames: number
  fps: number
}

const TransitionOverlay = memo(function TransitionOverlay({
  side,
  transitionId,
  presentation,
  durationInFrames,
  overlapFrames,
  clipDurationFrames,
  fps,
}: TransitionOverlayProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const widthPct = Math.min((overlapFrames / clipDurationFrames) * 100, 30)
  const color = transitionColor(presentation)
  const durationSec = (durationInFrames / fps).toFixed(1)

  return (
    <>
      <div
        ref={ref}
        className={cn(
          'absolute inset-y-0 cursor-pointer group z-10',
          side === 'left' ? 'left-0' : 'right-0',
        )}
        style={{ width: `${Math.max(widthPct, 3)}%` }}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title={`${presentation} · ${durationSec}s`}
      >
        {/* Diagonal stripe pattern */}
        <div
          className="absolute inset-0 group-hover:opacity-90 transition-opacity"
          style={{
            background: `repeating-linear-gradient(
              ${side === 'left' ? '45deg' : '-45deg'},
              transparent,
              transparent 2px,
              ${color} 2px,
              ${color} 4px
            )`,
            opacity: 0.7,
          }}
        />
        {/* Solid color edge line */}
        <div
          className={cn('absolute inset-y-0 w-[2px]', side === 'left' ? 'left-0' : 'right-0')}
          style={{ backgroundColor: color }}
        />
      </div>

      {open && (
        <FxPopover
          anchorRef={ref}
          title={`${presentation.charAt(0).toUpperCase() + presentation.slice(1)} Transition`}
          icon={<Sparkles className="h-3 w-3" />}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              Duration <span className="text-foreground font-mono">{durationSec}s</span>
            </div>
            <button
              className="w-full text-xs rounded px-2 py-1 bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
              onClick={() => {
                removeTransition(transitionId)
                setOpen(false)
              }}
            >
              Remove transition
            </button>
          </div>
        </FxPopover>
      )}
    </>
  )
})

// ── GPU Effect Badge ─────────────────────────────────────────────────────────

interface EffectBadgeProps {
  count: number
}

const EffectBadge = memo(function EffectBadge({ count }: EffectBadgeProps) {
  return (
    <div
      className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded px-1 py-0.5 bg-violet-500/70 text-white pointer-events-none"
      style={{ fontSize: 9, lineHeight: 1 }}
      title={`${count} effect${count !== 1 ? 's' : ''} applied`}
    >
      <Layers className="h-2 w-2" />
      <span>FX</span>
    </div>
  )
})

// ── Shared popover ───────────────────────────────────────────────────────────

interface FxPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>
  title: string
  icon: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}

function FxPopover({ anchorRef: _anchorRef, title, icon, onClose, children }: FxPopoverProps) {
  return createPortal(
    <>
      {/* Transparent backdrop — click outside to dismiss */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] w-52 rounded-lg border border-border bg-popover shadow-xl p-3 space-y-2.5"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <span className="text-primary">{icon}</span>
            {title}
          </div>
          <button
            className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  )
}

// ── Main FxBar ───────────────────────────────────────────────────────────────

interface FxBarProps {
  item: TimelineItem
  fps: number
  /** Whether to show the FX bar (not for audio-only items that have no visual) */
  isVisual: boolean
}

export const FxBar = memo(function FxBar({ item, fps, isVisual }: FxBarProps) {
  const kfsByItemId = useKeyframesStore((s) => s.keyframesByItemId)
  const transitions = useTransitionsStore((s) => s.transitions)
  const overlapByItemId = useTransitionsStore((s) => s.transitionOverlapByItemId)

  const zoomEvents = useMemo(
    () => (isVisual ? parseZoomEvents(item.id, kfsByItemId) : []),
    [isVisual, item.id, kfsByItemId],
  )

  const gpuEffects = useMemo(
    () => (item.effects ?? []).filter((e) => e.enabled !== false),
    [item.effects],
  )

  const leftTransition = useMemo(
    () => transitions.find((t) => t.rightClipId === item.id),
    [transitions, item.id],
  )
  const rightTransition = useMemo(
    () => transitions.find((t) => t.leftClipId === item.id),
    [transitions, item.id],
  )

  const overlap = overlapByItemId[item.id]

  const hasAnything =
    isVisual &&
    (zoomEvents.length > 0 || gpuEffects.length > 0 || leftTransition || rightTransition)
  if (!hasAnything) return null

  return (
    // Positioned at the bottom 7px of the clip, above audio controls.
    // pointer-events-auto so it intercepts clicks before the clip body.
    <div
      className="absolute bottom-0 left-0 right-0 pointer-events-auto overflow-visible"
      style={{ height: 7, zIndex: 8 }}
    >
      {/* Zoom effect segments */}
      {zoomEvents.map((ev, i) => (
        <ZoomSegment key={`zoom-${i}`} ev={ev} item={item} fps={fps} />
      ))}

      {/* Transition overlays */}
      {leftTransition && overlap && (
        <TransitionOverlay
          side="left"
          transitionId={leftTransition.id}
          presentation={leftTransition.presentation}
          durationInFrames={leftTransition.durationInFrames}
          overlapFrames={overlap.left}
          clipDurationFrames={item.durationInFrames}
          fps={fps}
        />
      )}
      {rightTransition && overlap && (
        <TransitionOverlay
          side="right"
          transitionId={rightTransition.id}
          presentation={rightTransition.presentation}
          durationInFrames={rightTransition.durationInFrames}
          overlapFrames={overlap.right}
          clipDurationFrames={item.durationInFrames}
          fps={fps}
        />
      )}

      {/* GPU effect count badge */}
      {gpuEffects.length > 0 && <EffectBadge count={gpuEffects.length} />}
    </div>
  )
})
