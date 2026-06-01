import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import { findNearestAvailableSpace } from '@/features/ai-chat/deps/timeline-utils'
import { addItem } from '@/features/ai-chat/deps/timeline-actions'
import { createClassicTrack } from '@/features/ai-chat/deps/timeline-contract'
import type { TextItem, TimelineTrack } from '@/types/timeline'

/**
 * Find a track suitable for captions: video-kind but containing no video/image clips.
 * If none exists, create a new video track above the topmost existing track.
 */
function getOrCreateCaptionTrack(): TimelineTrack {
  const { tracks, items } = useTimelineStore.getState()

  // Prefer a video-kind track that has no video or image items (a caption-only layer)
  const captionTrack = [...tracks]
    .sort((a, b) => a.order - b.order)
    .find((track) => {
      if (track.isGroup || track.locked) return false
      if (track.kind === 'audio') return false
      const hasVideoClip = items.some(
        (item) => item.trackId === track.id && (item.type === 'video' || item.type === 'image'),
      )
      return !hasVideoClip
    })

  if (captionTrack) return captionTrack

  // No caption-safe track exists — create one above the current top track
  const minOrder = tracks.reduce((min, t) => Math.min(min, t.order), 0)
  const newTrack = createClassicTrack({
    tracks,
    kind: 'video',
    order: minOrder - 1,
  })
  useTimelineStore.getState().setTracks([...tracks, newTrack])
  return newTrack
}

function parseTimeToFrames(time: string, fps: number): number {
  const parts = time
    .trim()
    .replace(/[→\-–]/g, '')
    .trim()
    .split(':')
  if (parts.length < 2) return 0
  const minutes = parseInt(parts[0] ?? '0', 10)
  const seconds = parseFloat(parts[1] ?? '0')
  return Math.round((minutes * 60 + seconds) * fps)
}

function splitIntoCaptions(text: string, maxWords = 9): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const result: string[] = []
  for (const sentence of sentences.length ? sentences : [text]) {
    const words = sentence.split(/\s+/)
    if (words.length <= maxWords) {
      result.push(sentence)
    } else {
      for (let i = 0; i < words.length; i += maxWords) {
        result.push(words.slice(i, i + maxWords).join(' '))
      }
    }
  }
  return result.filter(Boolean)
}

interface SceneInput {
  startTime: string
  endTime?: string
  text: string
}

registerTool({
  name: 'add_captions_from_script',
  description: `Use this tool when the user provides a video script, scene breakdown, or timestamped narration — to add captions across the entire video in one shot. Do NOT call add_text scene-by-scene when this tool can handle the full script at once.

When parsing the user message:
- Extract timestamps in MM:SS format (e.g. "00:26", "01:56", "04:09")
- For each scene, use ONLY the narration / voiceover text as caption content
- Skip "Business Impact", "Visuals", "Problem" sections — those are not captions
- If the user pastes a breakdown with Scene 1, Scene 2 etc., parse ALL scenes into the array
- If endTime is missing for a scene, omit it — the tool infers from the next scene's startTime

The tool splits long narration text into readable on-screen caption chunks and distributes them proportionally across each scene's duration.`,
  parameters: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        description: 'All scenes parsed from the script in order',
        items: {
          type: 'object',
          properties: {
            startTime: {
              type: 'string',
              description: 'Scene start time in MM:SS format e.g. "00:26"',
            },
            endTime: {
              type: 'string',
              description:
                'Scene end time in MM:SS format e.g. "00:55" — optional, inferred from next scene if omitted',
            },
            text: {
              type: 'string',
              description:
                'The narration / voiceover text that becomes on-screen captions for this scene',
            },
          },
          required: ['startTime', 'text'],
        },
      },
    },
    required: ['scenes'],
  },
  uiDescription: (args) => {
    const scenes = args['scenes'] as SceneInput[]
    return `Adding captions for ${scenes.length} scene${scenes.length !== 1 ? 's' : ''} from script`
  },
  handler: async (args) => {
    const scenes = args['scenes'] as SceneInput[]
    if (!scenes || scenes.length === 0) {
      return { ok: false, summary: 'No scenes provided' }
    }

    const fps = useTimelineStore.getState().fps
    const captionTrack = getOrCreateCaptionTrack()
    let totalCaptions = 0
    const sceneResults: Array<{ scene: number; captions: number; error?: string }> = []

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!
      const nextScene = scenes[i + 1]

      const startFrame = parseTimeToFrames(scene.startTime, fps)

      let endFrame: number
      if (scene.endTime) {
        endFrame = parseTimeToFrames(scene.endTime, fps)
      } else if (nextScene) {
        endFrame = parseTimeToFrames(nextScene.startTime, fps)
      } else {
        const { items } = useTimelineStore.getState()
        endFrame = items.reduce(
          (max, item) => Math.max(max, item.from + item.durationInFrames),
          startFrame + Math.round(fps * 5),
        )
      }

      const sceneDurationFrames = Math.max(fps, endFrame - startFrame)

      const captions = splitIntoCaptions(scene.text)
      if (captions.length === 0) {
        sceneResults.push({ scene: i + 1, captions: 0 })
        continue
      }

      const totalChars = captions.reduce((sum, c) => sum + c.length, 0) || 1
      const minFrames = Math.max(1, Math.round(fps * 0.75))
      let currentFrame = startFrame
      let sceneCaptions = 0
      let sceneError: string | undefined

      for (let j = 0; j < captions.length; j++) {
        const cap = captions[j]!
        const isLast = j === captions.length - 1
        const proportion = cap.length / totalChars
        const durFrames = isLast
          ? Math.max(minFrames, endFrame - currentFrame)
          : Math.max(minFrames, Math.round(proportion * sceneDurationFrames))

        try {
          const { items } = useTimelineStore.getState()

          const finalFrom =
            findNearestAvailableSpace(currentFrame, durFrames, captionTrack.id, items) ??
            currentFrame

          const textItem: TextItem = {
            id: crypto.randomUUID(),
            type: 'text',
            trackId: captionTrack.id,
            from: finalFrom,
            durationInFrames: durFrames,
            label: cap.slice(0, 40),
            originId: crypto.randomUUID(),
            text: cap,
            textRole: 'caption' as const,
            color: '#ffffff',
            fontSize: 40,
            fontWeight: 'semibold',
            textAlign: 'center',
            verticalAlign: 'bottom',
            backgroundColor: 'rgba(0,0,0,0.72)',
            backgroundRadius: 6,
            textPadding: 10,
          }

          addItem(textItem)
          currentFrame += durFrames
          sceneCaptions++
          totalCaptions++
        } catch (err) {
          sceneError = err instanceof Error ? err.message : String(err)
          break
        }
      }

      sceneResults.push({ scene: i + 1, captions: sceneCaptions, error: sceneError })
    }

    const errorCount = sceneResults.filter((r) => r.error).length
    const summary = `Added ${totalCaptions} caption${totalCaptions !== 1 ? 's' : ''} across ${scenes.length} scene${scenes.length !== 1 ? 's' : ''}${errorCount > 0 ? ` (${errorCount} scene${errorCount !== 1 ? 's' : ''} had errors)` : ''}`

    return {
      ok: errorCount === 0,
      summary,
      data: { totalCaptions, sceneCount: scenes.length, sceneResults },
    }
  },
})
