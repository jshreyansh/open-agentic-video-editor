import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import type { TrackKind } from '@/features/timeline/utils/classic-tracks'

registerTool({
  name: 'list_tracks',
  description: 'List all tracks on the timeline with their IDs, names, kind, and item counts.',
  parameters: { type: 'object', properties: {} },
  uiDescription: () => 'Listing tracks',
  handler: async () => {
    const { tracks, items } = useTimelineStore.getState()
    const trackList = tracks.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      locked: t.locked,
      muted: t.muted,
      itemCount: items.filter((i) => i.trackId === t.id).length,
    }))
    return {
      ok: true,
      summary: `${tracks.length} tracks: ${trackList.map((t) => t.name).join(', ')}`,
      data: { tracks: trackList },
    }
  },
})

registerTool({
  name: 'create_track',
  description: 'Create a new track on the timeline.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['video', 'audio'], description: 'Track type' },
      name: { type: 'string', description: 'Track name (optional, auto-named if omitted)' },
    },
    required: ['kind'],
  },
  uiDescription: (args) => `Creating ${args['kind']} track`,
  handler: async (args) => {
    const kind = args['kind'] as TrackKind
    const { tracks } = useTimelineStore.getState()

    const minOrder = tracks.length > 0 ? Math.min(...tracks.map((t) => t.order ?? 0)) : 0
    const newTrack = createClassicTrack({ tracks, kind, order: minOrder - 1 })

    if (args['name']) {
      newTrack.name = args['name'] as string
    }

    useTimelineStore.getState().setTracks([newTrack, ...tracks])
    return {
      ok: true,
      summary: `Created ${kind} track "${newTrack.name}"`,
      data: { trackId: newTrack.id, name: newTrack.name },
    }
  },
})
