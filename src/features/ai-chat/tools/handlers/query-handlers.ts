import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import { useKeyframesStore } from '@/features/ai-chat/deps/timeline-store'
import { useTransitionsStore } from '@/features/ai-chat/deps/timeline-stores'
import { usePlaybackStore } from '@/shared/state/playback'
import type { TextItem } from '@/types/timeline'

function framesToTime(frames: number, fps: number): string {
  const s = frames / fps
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

registerTool({
  name: 'get_timeline_state',
  description:
    'Read the full timeline: tracks, all items with positions/durations, active effects, keyframes summary, transitions. Call this first when you need to understand what is on the timeline before acting.',
  parameters: { type: 'object', properties: {} },
  uiDescription: () => 'Reading timeline state',
  handler: async () => {
    const { tracks, items, fps } = useTimelineStore.getState()
    const kfStore = useKeyframesStore.getState()
    const tsStore = useTransitionsStore.getState()

    const serialized = {
      fps,
      tracks: tracks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        muted: t.muted,
        locked: t.locked,
      })),
      items: items.map((item) => {
        const kf = kfStore.keyframesByItemId[item.id]
        const hasKf = kf && kf.properties.length > 0
        const transitions = tsStore.transitions.filter(
          (tr) => tr.leftClipId === item.id || tr.rightClipId === item.id,
        )
        return {
          id: item.id,
          type: item.type,
          trackId: item.trackId,
          label: item.label,
          from: item.from,
          durationInFrames: item.durationInFrames,
          startTime: framesToTime(item.from, fps),
          endTime: framesToTime(item.from + item.durationInFrames, fps),
          speed: item.speed ?? 1,
          volume: (item as { volume?: number }).volume,
          ...(item.type === 'text' ? { text: (item as TextItem).text } : {}),
          effects: (item.effects ?? []).map((e) => ({
            id: e.id,
            type: e.effect.gpuEffectType,
            enabled: e.enabled,
          })),
          hasKeyframes: hasKf,
          keyframeProperties: hasKf ? kf.properties.map((p) => p.property) : [],
          transitions: transitions.map((tr) => ({
            id: tr.id,
            side: tr.leftClipId === item.id ? 'right' : 'left',
            type: tr.type,
            durationInFrames: tr.durationInFrames,
          })),
        }
      }),
    }
    return {
      ok: true,
      summary: `Timeline has ${items.length} items across ${tracks.length} tracks`,
      data: { timeline: serialized },
    }
  },
})

registerTool({
  name: 'get_item_details',
  description:
    'Get deep details on a single timeline item: exact position, effects, all keyframes, transitions, source info.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the item to inspect' },
    },
    required: ['itemId'],
  },
  uiDescription: (args) => `Inspecting item ${String(args['itemId']).slice(0, 8)}`,
  handler: async (args) => {
    const { items, fps } = useTimelineStore.getState()
    const item = items.find((i) => i.id === args['itemId'])
    if (!item) return { ok: false, summary: `Item ${String(args['itemId'])} not found` }

    const kf = useKeyframesStore.getState().keyframesByItemId[item.id]
    const transitions = useTransitionsStore
      .getState()
      .transitions.filter((tr) => tr.leftClipId === item.id || tr.rightClipId === item.id)

    return {
      ok: true,
      summary: `Found item "${item.label}" at ${framesToTime(item.from, fps)}`,
      data: {
        id: item.id,
        type: item.type,
        label: item.label,
        trackId: item.trackId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        startTime: framesToTime(item.from, fps),
        endTime: framesToTime(item.from + item.durationInFrames, fps),
        speed: item.speed ?? 1,
        volume: (item as { volume?: number }).volume,
        effects: (item.effects ?? []).map((e) => ({
          id: e.id,
          gpuEffectType: e.effect.gpuEffectType,
          params: e.effect.params,
          enabled: e.enabled,
        })),
        keyframes: kf
          ? kf.properties.map((p) => ({
              property: p.property,
              frames: p.keyframes.map((k) => ({ id: k.id, frame: k.frame, value: k.value })),
            }))
          : [],
        transitions: transitions.map((tr) => ({
          id: tr.id,
          side: tr.leftClipId === item.id ? 'right' : 'left',
          partnerClipId: tr.leftClipId === item.id ? tr.rightClipId : tr.leftClipId,
          type: tr.type,
          durationInFrames: tr.durationInFrames,
        })),
        ...(item.type === 'text' ? { text: (item as TextItem).text } : {}),
      },
    }
  },
})

registerTool({
  name: 'find_items',
  description:
    'Search timeline items by label text, item type (video/audio/text/image), or time range. Returns matching items with their IDs. Use this to locate clips before editing them.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to search for in item labels (optional)' },
      itemType: {
        type: 'string',
        enum: ['video', 'audio', 'text', 'image', 'shape', 'adjustment'],
        description: 'Filter by item type (optional)',
      },
      fromFrame: {
        type: 'number',
        description: 'Only include items at or after this frame (optional)',
      },
      toFrame: {
        type: 'number',
        description: 'Only include items at or before this frame (optional)',
      },
    },
  },
  uiDescription: (args) => `Searching for ${args['query'] ?? args['itemType'] ?? 'items'}`,
  handler: async (args) => {
    const { items, fps } = useTimelineStore.getState()
    let results = [...items]

    if (args['query']) {
      const q = String(args['query']).toLowerCase()
      results = results.filter((i) => i.label.toLowerCase().includes(q))
    }
    if (args['itemType']) {
      results = results.filter((i) => i.type === args['itemType'])
    }
    if (args['fromFrame'] !== undefined) {
      const f = args['fromFrame'] as number
      results = results.filter((i) => i.from + i.durationInFrames > f)
    }
    if (args['toFrame'] !== undefined) {
      const t = args['toFrame'] as number
      results = results.filter((i) => i.from < t)
    }

    const mapped = results.map((i) => ({
      id: i.id,
      type: i.type,
      label: i.label,
      trackId: i.trackId,
      from: i.from,
      durationInFrames: i.durationInFrames,
      startTime: framesToTime(i.from, fps),
      endTime: framesToTime(i.from + i.durationInFrames, fps),
    }))

    return {
      ok: true,
      summary: `Found ${mapped.length} item${mapped.length !== 1 ? 's' : ''}`,
      data: { items: mapped, count: mapped.length },
    }
  },
})

registerTool({
  name: 'get_playhead_position',
  description: 'Get the current playhead position in frames and as a timestamp.',
  parameters: { type: 'object', properties: {} },
  uiDescription: () => 'Getting playhead position',
  handler: async () => {
    const { currentFrame } = usePlaybackStore.getState()
    const fps = useTimelineStore.getState().fps
    return {
      ok: true,
      summary: `Playhead at frame ${currentFrame} (${framesToTime(currentFrame, fps)})`,
      data: { frame: currentFrame, time: framesToTime(currentFrame, fps), fps },
    }
  },
})
