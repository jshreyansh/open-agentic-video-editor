import { useTimelineStore } from '@/features/editor/deps/timeline-store'

function framesToTimestamp(frames: number, fps: number): string {
  const totalSeconds = frames / fps
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(1)
  return `${minutes}:${seconds.padStart(4, '0')}`
}

export function serializeTimeline(): string {
  const { tracks, items, fps } = useTimelineStore.getState()

  const totalFrames = items.reduce(
    (max, item) => Math.max(max, item.from + item.durationInFrames),
    0,
  )

  const serializedTracks = tracks.map((track) => ({
    id: track.id,
    name: track.name,
    kind: track.kind,
  }))

  const serializedItems = items.map((item) => ({
    id: item.id,
    type: item.type,
    trackId: item.trackId,
    label: item.label,
    from: item.from,
    durationInFrames: item.durationInFrames,
    startTimestamp: framesToTimestamp(item.from, fps),
    endTimestamp: framesToTimestamp(item.from + item.durationInFrames, fps),
    speed: item.speed ?? 1,
    ...(item.type === 'text' ? { text: (item as { text: string }).text } : {}),
  }))

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
