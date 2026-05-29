import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useKeyframesStore } from '@/features/editor/deps/timeline-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import type { TextItem } from '@/types/timeline'

function framesToTimestamp(frames: number, fps: number): string {
  const totalSeconds = frames / fps
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(1)
  return `${minutes}:${seconds.padStart(4, '0')}`
}

export function serializeTimeline(): string {
  const { tracks, items, fps } = useTimelineStore.getState()
  const kfStore = useKeyframesStore.getState()
  const tsStore = useTransitionsStore.getState()

  const totalFrames = items.reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0,
  )

  const serializedTracks = tracks.map((track) => ({
    id: track.id,
    name: track.name,
    kind: track.kind,
    muted: track.muted,
    locked: track.locked,
  }))

  const serializedItems = items.map((item) => {
    const kf = kfStore.keyframesByItemId[item.id]
    const itemTransitions = tsStore.transitions.filter(
      (t) => t.leftClipId === item.id || t.rightClipId === item.id,
    )
    return {
      id: item.id,
      type: item.type,
      trackId: item.trackId,
      label: item.label,
      from: item.from,
      durationInFrames: item.durationInFrames,
      startTimestamp: framesToTimestamp(item.from, fps),
      endTimestamp: framesToTimestamp(item.from + item.durationInFrames, fps),
      speed: item.speed ?? 1,
      volume: (item as { volume?: number }).volume,
      ...(item.type === 'text' ? { text: (item as TextItem).text } : {}),
      effects: (item.effects ?? []).map((e) => ({
        id: e.id,
        type: e.effect.gpuEffectType,
        params: e.effect.params,
        enabled: e.enabled,
      })),
      keyframeProperties: kf ? kf.properties.map((p) => p.property) : [],
      transitions: itemTransitions.map((t) => ({
        side: t.leftClipId === item.id ? 'right' : 'left',
        type: t.type,
        durationInFrames: t.durationInFrames,
        partnerId: t.leftClipId === item.id ? t.rightClipId : t.leftClipId,
      })),
    }
  })

  return JSON.stringify(
    {
      fps,
      totalFrames,
      totalDuration: framesToTimestamp(totalFrames, fps),
      tracks: serializedTracks,
      items: serializedItems,
    },
    null,
    2,
  )
}
