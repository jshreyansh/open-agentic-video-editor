import { createLogger } from '@/shared/logging/logger'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/ai-chat/deps/timeline-utils'
import { useProjectStore } from '@/features/ai-chat/deps/projects'
import {
  removeItems,
  moveItem,
  updateItem,
  addItem,
} from '@/features/ai-chat/deps/timeline-actions'
import { splitItem } from '@/features/ai-chat/deps/timeline-actions'
import { trimItemStart, trimItemEnd } from '@/features/ai-chat/deps/timeline-actions'
import { addKeyframes, removeKeyframes } from '@/features/ai-chat/deps/timeline-actions'
import { addTransition, removeTransition } from '@/features/ai-chat/deps/timeline-actions'
import { useKeyframesStore } from '@/features/ai-chat/deps/timeline-stores'
import { useTransitionsStore } from '@/features/ai-chat/deps/timeline-stores'
import { generateTtsAudio } from './tts-provider'
import { saveGeneratedAudio } from '@/infrastructure/storage/generated-audio'
import type { TextItem, AudioItem } from '@/types/timeline'
import type { TransitionPresentation } from '@/types/transition'
import type { AiCommand } from './gemini-api'

// Parse the duration (seconds) from a WAV blob using the header.
async function getWavDuration(blob: Blob): Promise<number> {
  try {
    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    const sampleRate = view.getUint32(24, true)
    const numChannels = view.getUint16(22, true)
    const bitsPerSample = view.getUint16(34, true)
    const dataSize = view.getUint32(40, true)
    return dataSize / (sampleRate * numChannels * (bitsPerSample / 8))
  } catch {
    return 0
  }
}

// Split text into caption-sized chunks (max `maxWords` words each).
// Respects sentence boundaries first, then hard-splits long sentences.
function splitIntoCaptions(text: string, maxWords = 8): string[] {
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

// Distribute captions proportionally across totalSeconds, starting at startFrame.
function timeCaptions(
  captions: string[],
  totalSeconds: number,
  fps: number,
  startFrame: number,
): Array<{ text: string; from: number; durationInFrames: number }> {
  const totalChars = captions.reduce((sum, c) => sum + c.length, 0) || 1
  const totalFrames = Math.round(totalSeconds * fps)
  const minFrames = Math.max(1, Math.round(fps * 0.75))
  let frame = startFrame
  return captions.map((text, i) => {
    const isLast = i === captions.length - 1
    const proportion = text.length / totalChars
    const dur = isLast
      ? Math.max(minFrames, startFrame + totalFrames - frame)
      : Math.max(minFrames, Math.round(proportion * totalFrames))
    const entry = { text, from: frame, durationInFrames: dur }
    frame += dur
    return entry
  })
}

const log = createLogger('ai-chat:command-executor')

export async function executeCommands(commands: AiCommand[]): Promise<void> {
  for (const cmd of commands) {
    try {
      await executeOne(cmd)
    } catch (err) {
      log.warn('Command failed:', cmd.type, err)
    }
  }
}

async function executeOne(cmd: AiCommand): Promise<void> {
  switch (cmd.type) {
    case 'delete_items': {
      const ids = cmd.itemIds as string[]
      if (ids.length > 0) removeItems(ids)
      break
    }

    case 'add_text': {
      const { tracks, items } = useTimelineStore.getState()
      const track = findCompatibleTrackForItemType({
        tracks,
        items,
        itemType: 'text',
        preferredTrackId: undefined,
      })
      if (!track) break

      const from = cmd.from as number
      const durationInFrames = cmd.durationInFrames as number
      const finalFrom = findNearestAvailableSpace(from, durationInFrames, track.id, items) ?? from

      const textItem: TextItem = {
        id: crypto.randomUUID(),
        type: 'text',
        trackId: track.id,
        from: finalFrom,
        durationInFrames,
        label: (cmd.text as string).slice(0, 40),
        originId: crypto.randomUUID(),
        text: cmd.text as string,
        color: '#ffffff',
        fontSize: 48,
        fontWeight: 'semibold',
        textAlign: 'center',
        verticalAlign: 'bottom',
        backgroundColor: 'rgba(0,0,0,0.6)',
        backgroundRadius: 8,
        textPadding: 12,
      }

      useTimelineStore.getState().addItem(textItem)
      log.debug('Added text item at frame', finalFrom)
      break
    }

    case 'split_item': {
      splitItem(cmd.itemId as string, cmd.atFrame as number)
      break
    }

    case 'trim_start': {
      trimItemStart(cmd.itemId as string, cmd.trimAmount as number)
      break
    }

    case 'trim_end': {
      trimItemEnd(cmd.itemId as string, cmd.trimAmount as number)
      break
    }

    case 'move_item': {
      moveItem(cmd.itemId as string, cmd.newFrom as number)
      break
    }

    case 'update_speed': {
      updateItem(cmd.itemId as string, { speed: cmd.speed as number })
      break
    }

    case 'set_volume': {
      updateItem(cmd.itemId as string, { volume: cmd.volumeDb as number })
      break
    }

    case 'mute_item': {
      updateItem(cmd.itemId as string, { volume: -60 })
      break
    }

    case 'add_transition': {
      const presentation = (cmd.presentation ?? 'fade') as TransitionPresentation
      const duration = (cmd.durationInFrames as number | undefined) ?? 30
      addTransition(
        cmd.leftItemId as string,
        cmd.rightItemId as string,
        'crossfade',
        duration,
        presentation,
      )
      break
    }

    case 'add_zoom': {
      const state = useTimelineStore.getState()
      const item = state.items.find((i) => i.id === (cmd.itemId as string))
      if (!item) break

      const fps = state.fps
      const atFrame = cmd.atFrame as number
      const level = (cmd.level as number | undefined) ?? 1.3
      const rawHold = (cmd.durationInFrames as number | undefined) ?? Math.round(fps * 2)
      const holdFrames = Math.max(Math.round(fps * 1.0), rawHold) // minimum 1-second hold
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
      break
    }

    case 'add_voiceover': {
      const text = cmd.text as string
      const requestedFrom = (cmd.from as number | undefined) ?? 0

      // 1. Generate audio and measure exact duration from the WAV header
      const audioBlob = await generateTtsAudio(text)
      const audioSrc = URL.createObjectURL(audioBlob)
      const audioDurationSec = await getWavDuration(audioBlob)
      const fps = useTimelineStore.getState().fps
      // Fall back to word-count estimate if WAV parse fails
      const durationSec =
        audioDurationSec > 0 ? audioDurationSec : Math.max(2, text.trim().split(/\s+/).length / 2.5)
      const durationInFrames = Math.round(durationSec * fps)

      // 2. Place audio item on an audio track
      const { tracks, items } = useTimelineStore.getState()
      const audioTrack = findCompatibleTrackForItemType({
        tracks,
        items,
        itemType: 'audio',
        preferredTrackId: undefined,
      })
      if (!audioTrack) break

      const finalFrom =
        findNearestAvailableSpace(requestedFrom, durationInFrames, audioTrack.id, items) ??
        requestedFrom
      const generatedAudioKey = crypto.randomUUID()
      await saveGeneratedAudio(generatedAudioKey, audioBlob)

      const audioItem: AudioItem = {
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audioTrack.id,
        from: finalFrom,
        durationInFrames,
        label: text.slice(0, 40),
        src: audioSrc,
        generatedAudioKey,
      }
      addItem(audioItem)

      // 3. Auto-generate synchronized captions on a text track
      const captions = splitIntoCaptions(text)
      const timedCaptions = timeCaptions(captions, durationSec, fps, finalFrom)

      for (const cap of timedCaptions) {
        const { tracks: t2, items: i2 } = useTimelineStore.getState()
        const textTrack = findCompatibleTrackForItemType({
          tracks: t2,
          items: i2,
          itemType: 'text',
          preferredTrackId: undefined,
        })
        if (!textTrack) break

        const capFrom =
          findNearestAvailableSpace(cap.from, cap.durationInFrames, textTrack.id, i2) ?? cap.from
        const textItem: TextItem = {
          id: crypto.randomUUID(),
          type: 'text',
          trackId: textTrack.id,
          from: capFrom,
          durationInFrames: cap.durationInFrames,
          label: cap.text.slice(0, 40),
          originId: crypto.randomUUID(),
          text: cap.text,
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
        useTimelineStore.getState().addItem(textItem)
      }

      log.debug(
        'Added voiceover + captions at frame',
        finalFrom,
        `(${captions.length} segments, ${Math.round(durationSec)}s)`,
      )
      break
    }

    case 'voiceover_from_captions': {
      // Generate voiceover audio from one or more existing text items
      const itemIds = cmd.itemIds as string[]

      const { items } = useTimelineStore.getState()
      // Sort by start frame so speech follows visual order
      const textItems = itemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined && i.type === 'text')
        .sort((a, b) => a.from - b.from)

      if (textItems.length === 0) break

      const combinedText = textItems.map((i) => (i as TextItem).text).join(' ')
      const firstFrom = textItems[0]!.from

      const audioBlob = await generateTtsAudio(combinedText)
      const audioSrc = URL.createObjectURL(audioBlob)
      const audioDurationSec = await getWavDuration(audioBlob)
      const fps = useTimelineStore.getState().fps
      const durationSec =
        audioDurationSec > 0
          ? audioDurationSec
          : Math.max(2, combinedText.trim().split(/\s+/).length / 2.5)
      const durationInFrames = Math.round(durationSec * fps)

      const { tracks, items: items2 } = useTimelineStore.getState()
      const audioTrack = findCompatibleTrackForItemType({
        tracks,
        items: items2,
        itemType: 'audio',
        preferredTrackId: undefined,
      })
      if (!audioTrack) break

      const finalFrom =
        findNearestAvailableSpace(firstFrom, durationInFrames, audioTrack.id, items2) ?? firstFrom
      const generatedAudioKey = crypto.randomUUID()
      await saveGeneratedAudio(generatedAudioKey, audioBlob)

      const audioItem: AudioItem = {
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audioTrack.id,
        from: finalFrom,
        durationInFrames,
        label: combinedText.slice(0, 40),
        src: audioSrc,
        generatedAudioKey,
      }
      addItem(audioItem)
      log.debug('Generated voiceover from captions at frame', finalFrom)
      break
    }

    case 'remove_zoom': {
      // Find and remove all zoom keyframes (width+height groups of 4) near atFrame
      const itemId = cmd.itemId as string
      const atFrame = cmd.atFrame as number
      const tolerance = 90 // ±3s at 30fps — finds the right zoom group

      const itemKf = useKeyframesStore.getState().keyframesByItemId[itemId]
      if (!itemKf) break

      const widthProp = itemKf.properties.find((p) => p.property === 'width')
      const heightProp = itemKf.properties.find((p) => p.property === 'height')
      if (!widthProp) break

      // Group width kfs into sets of 4, find the one whose peak is closest to atFrame
      const wKfs = [...widthProp.keyframes].sort((a, b) => a.frame - b.frame)
      const refs: import('@/types/keyframe').KeyframeRef[] = []

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
      if (refs.length > 0) removeKeyframes(refs)
      break
    }

    case 'remove_transition': {
      const { leftItemId, rightItemId } = cmd as { leftItemId?: string; rightItemId?: string }
      const transitions = useTransitionsStore.getState().transitions
      const match = transitions.find(
        (t) =>
          (leftItemId && t.leftClipId === leftItemId) ||
          (rightItemId && t.rightClipId === rightItemId),
      )
      if (match) removeTransition(match.id)
      break
    }

    default:
      log.warn('Unknown command type:', (cmd as { type: string }).type)
  }
}
