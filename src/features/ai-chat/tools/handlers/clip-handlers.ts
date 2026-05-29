import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/ai-chat/deps/timeline-utils'
import {
  removeItems,
  moveItem,
  updateItem,
  addItem,
} from '@/features/ai-chat/deps/timeline-actions'
import { splitItem } from '@/features/ai-chat/deps/timeline-actions'
import { trimItemStart, trimItemEnd } from '@/features/ai-chat/deps/timeline-actions'
import type { TextItem } from '@/types/timeline'

registerTool({
  name: 'delete_items',
  description: 'Remove one or more clips from the timeline by their IDs.',
  parameters: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of items to delete',
      },
    },
    required: ['itemIds'],
  },
  uiDescription: (args) => `Deleting ${(args['itemIds'] as string[]).length} item(s)`,
  handler: async (args) => {
    const ids = args['itemIds'] as string[]
    if (ids.length === 0) return { ok: false, summary: 'No item IDs provided' }
    removeItems(ids)
    return {
      ok: true,
      summary: `Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}`,
      data: { deleted: ids.length },
    }
  },
})

registerTool({
  name: 'move_item',
  description: 'Move a clip to a new start frame on the timeline.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip to move' },
      toFrame: { type: 'number', description: 'New start frame (0-based, project FPS)' },
    },
    required: ['itemId', 'toFrame'],
  },
  uiDescription: (args) => `Moving clip to frame ${args['toFrame']}`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const toFrame = args['toFrame'] as number
    const { items } = useTimelineStore.getState()
    const item = items.find((i) => i.id === itemId)
    if (!item) return { ok: false, summary: `Item ${itemId} not found` }
    moveItem(itemId, toFrame)
    return {
      ok: true,
      summary: `Moved "${item.label}" to frame ${toFrame}`,
      data: { newFrom: toFrame },
    }
  },
})

registerTool({
  name: 'trim_item',
  description: 'Trim frames from the start and/or end of a clip. Positive values shrink the clip.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip to trim' },
      trimStart: {
        type: 'number',
        description: 'Frames to trim from the beginning (positive = remove frames)',
      },
      trimEnd: {
        type: 'number',
        description: 'Frames to trim from the end (positive = remove frames)',
      },
    },
    required: ['itemId'],
  },
  uiDescription: (_args) => `Trimming clip`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const { items } = useTimelineStore.getState()
    const item = items.find((i) => i.id === itemId)
    if (!item) return { ok: false, summary: `Item ${itemId} not found` }

    if (args['trimStart']) trimItemStart(itemId, args['trimStart'] as number)
    if (args['trimEnd']) trimItemEnd(itemId, args['trimEnd'] as number)

    const newItem = useTimelineStore.getState().items.find((i) => i.id === itemId)
    return {
      ok: true,
      summary: `Trimmed "${item.label}"`,
      data: { newFrom: newItem?.from, newDuration: newItem?.durationInFrames },
    }
  },
})

registerTool({
  name: 'split_item',
  description: 'Split a clip into two clips at a specific frame.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip to split' },
      atFrame: { type: 'number', description: 'Frame number where the split happens' },
    },
    required: ['itemId', 'atFrame'],
  },
  uiDescription: (args) => `Splitting clip at frame ${args['atFrame']}`,
  handler: async (args) => {
    const { items } = useTimelineStore.getState()
    const item = items.find((i) => i.id === (args['itemId'] as string))
    if (!item) return { ok: false, summary: `Item ${String(args['itemId'])} not found` }
    splitItem(args['itemId'] as string, args['atFrame'] as number)
    return { ok: true, summary: `Split "${item.label}" at frame ${args['atFrame']}` }
  },
})

registerTool({
  name: 'set_volume',
  description: 'Set the volume of a clip in decibels. 0 = unity, -60 = silence, +6 = boost.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip' },
      volumeDb: { type: 'number', description: 'Volume in dB (range: -60 to +12)' },
    },
    required: ['itemId', 'volumeDb'],
  },
  uiDescription: (args) => `Setting volume to ${args['volumeDb']}dB`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const db = Math.max(-60, Math.min(12, args['volumeDb'] as number))
    updateItem(itemId, { volume: db })
    return { ok: true, summary: `Set volume to ${db}dB`, data: { volumeDb: db } }
  },
})

registerTool({
  name: 'mute_item',
  description: 'Mute a clip completely (sets volume to -60dB).',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip to mute' },
    },
    required: ['itemId'],
  },
  uiDescription: () => 'Muting clip',
  handler: async (args: Record<string, unknown>) => {
    updateItem(args['itemId'] as string, { volume: -60 })
    return { ok: true, summary: 'Clip muted' }
  },
})

registerTool({
  name: 'change_speed',
  description:
    'Change the playback speed of a clip. 1.0 = normal, 2.0 = double speed, 0.5 = half speed.',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'ID of the clip' },
      speed: { type: 'number', description: 'Speed multiplier (0.1–10.0)' },
    },
    required: ['itemId', 'speed'],
  },
  uiDescription: (args) => `Setting speed to ${args['speed']}x`,
  handler: async (args) => {
    const itemId = args['itemId'] as string
    const speed = Math.max(0.1, Math.min(10, args['speed'] as number))
    const { items } = useTimelineStore.getState()
    const item = items.find((i) => i.id === itemId)
    if (!item) return { ok: false, summary: `Item ${itemId} not found` }
    updateItem(itemId, { speed })
    const newDuration = Math.round(item.durationInFrames / speed)
    return { ok: true, summary: `Speed set to ${speed}x`, data: { speed, newDuration } }
  },
})

registerTool({
  name: 'add_text',
  description: 'Add a text caption overlay to the timeline at a specific time.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The caption text' },
      fromFrame: { type: 'number', description: 'Start frame (multiply seconds × fps)' },
      durationInFrames: { type: 'number', description: 'Duration in frames' },
    },
    required: ['text', 'fromFrame', 'durationInFrames'],
  },
  uiDescription: (args) => `Adding text: "${String(args['text']).slice(0, 30)}"`,
  handler: async (args) => {
    const { tracks, items } = useTimelineStore.getState()
    const track = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'text',
      preferredTrackId: undefined,
    })
    if (!track) return { ok: false, summary: 'No compatible text track available' }

    const from = args['fromFrame'] as number
    const durationInFrames = args['durationInFrames'] as number
    const finalFrom = findNearestAvailableSpace(from, durationInFrames, track.id, items) ?? from

    const textItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      trackId: track.id,
      from: finalFrom,
      durationInFrames,
      label: (args['text'] as string).slice(0, 40),
      originId: crypto.randomUUID(),
      text: args['text'] as string,
      color: '#ffffff',
      fontSize: 48,
      fontWeight: 'semibold',
      textAlign: 'center',
      verticalAlign: 'bottom',
      backgroundColor: 'rgba(0,0,0,0.6)',
      backgroundRadius: 8,
      textPadding: 12,
    }

    addItem(textItem)
    return {
      ok: true,
      summary: `Added text at frame ${finalFrom}`,
      data: { itemId: textItem.id, from: finalFrom },
    }
  },
})
