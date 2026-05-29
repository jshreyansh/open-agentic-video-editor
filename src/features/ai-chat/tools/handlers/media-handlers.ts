import { registerTool } from '../tool-registry'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/editor/deps/timeline-utils'
import { addItem } from '@/features/timeline/stores/actions/item-actions'
import { generateTtsAudio } from '../../services/tts-provider'
import { saveGeneratedAudio } from '@/infrastructure/storage/generated-audio'
import type { TextItem, AudioItem } from '@/types/timeline'

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

registerTool({
  name: 'add_voiceover',
  description:
    'Generate AI voiceover audio from text and place it on an audio track. Automatically creates synchronized captions. Do NOT add separate add_text commands for the same text.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The voiceover script text' },
      fromFrame: { type: 'number', description: 'Start frame (default: 0)' },
    },
    required: ['text'],
  },
  uiDescription: (args) => `Generating voiceover: "${String(args['text']).slice(0, 40)}"`,
  handler: async (args) => {
    const text = args['text'] as string
    const requestedFrom = (args['fromFrame'] as number | undefined) ?? 0

    const audioBlob = await generateTtsAudio(text)
    const audioSrc = URL.createObjectURL(audioBlob)
    const audioDurationSec = await getWavDuration(audioBlob)
    const fps = useTimelineStore.getState().fps
    const durationSec =
      audioDurationSec > 0 ? audioDurationSec : Math.max(2, text.trim().split(/\s+/).length / 2.5)
    const durationInFrames = Math.round(durationSec * fps)

    const { tracks, items } = useTimelineStore.getState()
    const audioTrack = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'audio',
      preferredTrackId: undefined,
    })
    if (!audioTrack) return { ok: false, summary: 'No audio track available' }

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

    const captions = splitIntoCaptions(text)
    const timedCaptions = timeCaptions(captions, durationSec, fps, finalFrom)
    const captionIds: string[] = []

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
      captionIds.push(textItem.id)
    }

    return {
      ok: true,
      summary: `Added voiceover (${Math.round(durationSec)}s) with ${captionIds.length} caption segments`,
      data: { audioItemId: audioItem.id, captionItemIds: captionIds, durationSec },
    }
  },
})

registerTool({
  name: 'generate_voiceover_for_captions',
  description:
    'Generate voiceover audio from existing text/caption items already on the timeline. Items are sorted by start frame and their text is read in order.',
  parameters: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of the text items to read aloud',
      },
    },
    required: ['itemIds'],
  },
  uiDescription: (args) =>
    `Generating voiceover from ${(args['itemIds'] as string[]).length} captions`,
  handler: async (args) => {
    const itemIds = args['itemIds'] as string[]
    const { items } = useTimelineStore.getState()

    const textItems = itemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => i !== undefined && i.type === 'text')
      .sort((a, b) => a.from - b.from)

    if (textItems.length === 0) return { ok: false, summary: 'No matching text items found' }

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
    if (!audioTrack) return { ok: false, summary: 'No audio track available' }

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

    return {
      ok: true,
      summary: `Generated voiceover from ${textItems.length} caption(s) (${Math.round(durationSec)}s)`,
      data: { audioItemId: audioItem.id, durationSec, captionCount: textItems.length },
    }
  },
})
