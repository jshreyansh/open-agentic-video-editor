import { createLogger } from '@/shared/logging/logger'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { VideoItem } from '@/types/timeline'

const log = createLogger('ai-chat:video-analyzer')

// Extract frames from a video blob URL as base64 JPEG strings.
// Seeks to each timestamp (seconds), draws to canvas, returns base64 data.
export async function extractVideoFrames(
  videoSrc: string,
  timestampsSec: number[],
  maxWidth = 640,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('No canvas 2D context'))
      return
    }

    video.addEventListener(
      'loadedmetadata',
      () => {
        const aspect = video.videoHeight / video.videoWidth
        canvas.width = Math.min(maxWidth, video.videoWidth)
        canvas.height = Math.round(canvas.width * aspect)

        const frames: string[] = []
        let i = 0

        const seekNext = () => {
          if (i >= timestampsSec.length) {
            video.src = ''
            resolve(frames)
            return
          }
          video.currentTime = Math.max(0, Math.min(timestampsSec[i]!, video.duration - 0.05))
        }

        video.addEventListener('seeked', () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const b64 = canvas.toDataURL('image/jpeg', 0.72).split(',')[1]
          if (b64) frames.push(b64)
          i++
          seekNext()
        })

        seekNext()
      },
      { once: true },
    )

    video.addEventListener('error', () =>
      reject(new Error('Video failed to load for frame extraction')),
    )
    video.src = videoSrc
    video.load()
  })
}

// Evenly-spaced sample points across a time range.
export function sampleTimestamps(startSec: number, endSec: number, count = 6): number[] {
  const dur = endSec - startSec
  if (dur <= 0 || count <= 0) return [startSec]
  if (count === 1) return [startSec + dur / 2]
  return Array.from({ length: count }, (_, i) => startSec + (i / (count - 1)) * dur)
}

export interface VideoFrameSet {
  frames: string[] // base64 JPEG
  startSec: number
  endSec: number
  itemId: string
}

// Extract frames for a timeline segment (startFrame..endFrame).
// Finds all video items that overlap the range, samples up to `framesPerClip` from each.
export async function extractSegmentFrames(
  startFrame: number,
  endFrame: number,
  fps: number,
  framesPerClip = 5,
): Promise<VideoFrameSet[]> {
  const { items } = useTimelineStore.getState()
  const videoItems = items.filter((it): it is VideoItem => {
    if (it.type !== 'video') return false
    const itemEnd = it.from + it.durationInFrames
    return it.from < endFrame && itemEnd > startFrame
  })

  if (videoItems.length === 0) {
    log.debug('No video items found in segment', startFrame, '—', endFrame)
    return []
  }

  const results: VideoFrameSet[] = []

  for (const item of videoItems) {
    const src = item.src
    if (!src || (!src.startsWith('blob:') && !src.startsWith('http'))) {
      log.debug('Skipping item with non-blob src', item.id)
      continue
    }

    // Clamp to segment and convert to source-video seconds
    const overlapStart = Math.max(item.from, startFrame)
    const overlapEnd = Math.min(item.from + item.durationInFrames, endFrame)
    const overlapStartSec = (overlapStart - item.from) / fps
    const overlapEndSec = (overlapEnd - item.from) / fps

    const timestamps = sampleTimestamps(overlapStartSec, overlapEndSec, framesPerClip)

    try {
      const frames = await extractVideoFrames(src, timestamps)
      results.push({
        frames,
        startSec: overlapStart / fps,
        endSec: overlapEnd / fps,
        itemId: item.id,
      })
      log.debug(`Extracted ${frames.length} frames from item ${item.id}`)
    } catch (err) {
      log.warn('Frame extraction failed for item', item.id, err)
    }
  }

  return results
}
