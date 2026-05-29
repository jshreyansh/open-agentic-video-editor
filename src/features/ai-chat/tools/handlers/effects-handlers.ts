import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import { useKeyframesStore } from '@/features/ai-chat/deps/timeline-store'
import { useTransitionsStore } from '@/features/ai-chat/deps/timeline-stores'
import { addKeyframes, removeKeyframes } from '@/features/ai-chat/deps/timeline-actions'
import { addTransition, removeTransition } from '@/features/ai-chat/deps/timeline-actions'
import { addEffect } from '@/features/ai-chat/deps/timeline-actions'
import { useProjectStore } from '@/features/ai-chat/deps/projects'
import type { TransitionPresentation } from '@/types/transition'
import type { KeyframeRef } from '@/types/keyframe'

registerTool({
  name: 'add_transition',
  description:
    'Add a transition between two adjacent clips. The clips must be on the same track and touching/overlapping.',
  parameters: {
    type: 'object',
    properties: {
      leftItemId: { type: 'string', description: 'ID of the clip on the left (earlier)' },
      rightItemId: { type: 'string', description: 'ID of the clip on the right (later)' },
      presentation: {
        type: 'string',
        enum: [
          'fade',
          'dissolve',
          'wipe',
          'slide',
          'flip',
          'sparkles',
          'glitch',
          'pixelate',
          'chromatic',
        ],
        description: 'Transition style',
      },
      durationInFrames: {
        type: 'number',
        description: 'Transition length in frames (default: 30)',
      },
    },
    required: ['leftItemId', 'rightItemId'],
  },
  uiDescription: (args) => `Adding ${args['presentation'] ?? 'fade'} transition`,
  handler: async (args) => {
    const presentation = ((args['presentation'] as string | undefined) ??
      'fade') as TransitionPresentation
    const duration = (args['durationInFrames'] as number | undefined) ?? 30
    addTransition(
      args['leftItemId'] as string,
      args['rightItemId'] as string,
      'crossfade',
      duration,
      presentation,
    )
    return { ok: true, summary: `Added ${presentation} transition (${duration} frames)` }
  },
})

registerTool({
  name: 'remove_transition',
  description: 'Remove a transition between two clips.',
  parameters: {
    type: 'object',
    properties: {
      leftItemId: {
        type: 'string',
        description: 'ID of the clip on the left side of the transition (optional)',
      },
      rightItemId: {
        type: 'string',
        description: 'ID of the clip on the right side of the transition (optional)',
      },
    },
  },
  uiDescription: () => 'Removing transition',
  handler: async (args) => {
    const { leftItemId, rightItemId } = args as { leftItemId?: string; rightItemId?: string }
    const transitions = useTransitionsStore.getState().transitions
    const match = transitions.find(
      (t) =>
        (leftItemId && t.leftClipId === leftItemId) ||
        (rightItemId && t.rightClipId === rightItemId),
    )
    if (!match) return { ok: false, summary: 'No matching transition found' }
    removeTransition(match.id)
    return { ok: true, summary: 'Transition removed' }
  },
})

registerTool({
  name: 'add_zoom',
  description:
    'Add a smooth punch-in zoom effect on a clip: ramps in, holds at peak, ramps out. Great for emphasizing moments.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip to zoom' },
      atFrame: { type: 'number', description: 'Project frame where the zoom peaks' },
      level: { type: 'number', description: 'Zoom level (1.0–2.0, default 1.3)' },
      holdFrames: {
        type: 'number',
        description: 'How long the zoom holds at peak (default: 2×fps)',
      },
    },
    required: ['itemId', 'atFrame'],
  },
  uiDescription: (args) => `Adding ${args['level'] ?? 1.3}x zoom at frame ${args['atFrame']}`,
  handler: async (args) => {
    const state = useTimelineStore.getState()
    const item = state.items.find((i) => i.id === (args['itemId'] as string))
    if (!item) return { ok: false, summary: `Item ${String(args['itemId'])} not found` }

    const fps = state.fps
    const atFrame = args['atFrame'] as number
    const level = (args['level'] as number | undefined) ?? 1.3
    const rawHold = (args['holdFrames'] as number | undefined) ?? Math.round(fps * 2)
    const holdFrames = Math.max(Math.round(fps * 1.0), rawHold)
    const ramp = Math.round(fps * 0.4)

    const meta = useProjectStore.getState().currentProject?.metadata
    const baseW = item.transform?.width ?? meta?.width ?? 1920
    const baseH = item.transform?.height ?? meta?.height ?? 1080
    const zoomW = Math.round(baseW * level)
    const zoomH = Math.round(baseH * level)

    addKeyframes([
      { itemId: item.id, property: 'width', frame: atFrame - ramp, value: baseW },
      { itemId: item.id, property: 'height', frame: atFrame - ramp, value: baseH },
      { itemId: item.id, property: 'width', frame: atFrame, value: zoomW },
      { itemId: item.id, property: 'height', frame: atFrame, value: zoomH },
      { itemId: item.id, property: 'width', frame: atFrame + holdFrames, value: zoomW },
      { itemId: item.id, property: 'height', frame: atFrame + holdFrames, value: zoomH },
      { itemId: item.id, property: 'width', frame: atFrame + holdFrames + ramp, value: baseW },
      { itemId: item.id, property: 'height', frame: atFrame + holdFrames + ramp, value: baseH },
    ])
    return {
      ok: true,
      summary: `Added ${level}x zoom at frame ${atFrame} (hold: ${holdFrames} frames)`,
    }
  },
})

registerTool({
  name: 'remove_zoom',
  description:
    'Remove a zoom effect from a clip. Finds the zoom group nearest to the specified frame.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip' },
      atFrame: { type: 'number', description: 'Approximate peak frame of the zoom to remove' },
    },
    required: ['itemId', 'atFrame'],
  },
  uiDescription: (args) => `Removing zoom at frame ${args['atFrame']}`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const atFrame = args['atFrame'] as number
    const tolerance = 90

    const itemKf = useKeyframesStore.getState().keyframesByItemId[itemId]
    if (!itemKf) return { ok: false, summary: 'No keyframes found on item' }

    const widthProp = itemKf.properties.find((p) => p.property === 'width')
    const heightProp = itemKf.properties.find((p) => p.property === 'height')
    if (!widthProp) return { ok: false, summary: 'No zoom keyframes found' }

    const wKfs = [...widthProp.keyframes].sort((a, b) => a.frame - b.frame)
    const refs: KeyframeRef[] = []

    for (let i = 0; i + 3 < wKfs.length; i += 4) {
      const peak = wKfs[i + 1]!
      if (Math.abs(peak.frame - atFrame) <= tolerance) {
        refs.push(
          ...[wKfs[i]!, wKfs[i + 1]!, wKfs[i + 2]!, wKfs[i + 3]!].map((k) => ({
            itemId,
            property: 'width' as const,
            keyframeId: k.id,
          })),
        )
        if (heightProp) {
          const hKfs = [...heightProp.keyframes].sort((a, b) => a.frame - b.frame)
          const hSlice = hKfs.slice(i, i + 4)
          refs.push(
            ...hSlice.map((k) => ({
              itemId,
              property: 'height' as const,
              keyframeId: k.id,
            })),
          )
        }
        break
      }
    }

    if (refs.length === 0) return { ok: false, summary: `No zoom found near frame ${atFrame}` }
    removeKeyframes(refs)
    return { ok: true, summary: `Removed zoom near frame ${atFrame}` }
  },
})

registerTool({
  name: 'add_effect',
  description:
    'Add a GPU visual effect to a clip. Available effects: gpu-brightness, gpu-contrast, gpu-saturation, gpu-hue-shift, gpu-blur, gpu-grayscale, gpu-sepia, gpu-sharpness, gpu-noise.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip' },
      gpuEffectType: {
        type: 'string',
        enum: [
          'gpu-brightness',
          'gpu-contrast',
          'gpu-saturation',
          'gpu-hue-shift',
          'gpu-blur',
          'gpu-grayscale',
          'gpu-sepia',
          'gpu-sharpness',
          'gpu-noise',
        ],
        description: 'Effect type to apply',
      },
      params: {
        type: 'object',
        description:
          'Effect parameters (e.g. { "amount": 0.5 } for brightness/contrast/saturation, { "shift": 0.3 } for hue-shift, { "radius": 4 } for blur)',
      },
    },
    required: ['itemId', 'gpuEffectType'],
  },
  uiDescription: (args) => `Adding ${args['gpuEffectType']} effect`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const { items } = useTimelineStore.getState()
    const item = items.find((i) => i.id === itemId)
    if (!item) return { ok: false, summary: `Item ${itemId} not found` }

    const effect = {
      type: 'gpu-effect' as const,
      gpuEffectType: args['gpuEffectType'] as string,
      params: (args['params'] as Record<string, number | boolean | string> | undefined) ?? {},
    }
    addEffect(itemId, effect)
    return { ok: true, summary: `Added ${args['gpuEffectType']} to "${item.label}"` }
  },
})
