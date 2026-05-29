import { createLogger } from '@/shared/logging/logger'
import type { AudioItem } from '@/types/timeline'

const log = createLogger('storage:generated-audio')
const DIR = 'generated-audio'

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR, { create: true })
}

// Write a WAV blob to OPFS under generated-audio/{key}.wav.
// Called immediately after AI voiceover generation so the audio persists beyond the session.
export async function saveGeneratedAudio(key: string, blob: Blob): Promise<void> {
  try {
    const dir = await getDir()
    const fh = await dir.getFileHandle(`${key}.wav`, { create: true })
    const writable = await fh.createWritable()
    await writable.write(blob)
    await writable.close()
    log.debug('Saved generated audio', key, blob.size, 'bytes')
  } catch (err) {
    log.warn('Failed to save generated audio to OPFS', key, err)
  }
}

// Read a previously-saved audio file from OPFS and return a fresh blob URL.
// Returns null if the file doesn't exist (e.g. OPFS was cleared).
export async function loadGeneratedAudioUrl(key: string): Promise<string | null> {
  try {
    const dir = await getDir()
    const fh = await dir.getFileHandle(`${key}.wav`)
    const file = await fh.getFile()
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

// After a project loads, scan audio items with generatedAudioKey and patch their src
// with a fresh blob URL from OPFS. Mutates the items store directly (no undo entry).
export async function resolveGeneratedAudioItems(
  items: AudioItem[],
  updateItemSrc: (id: string, src: string) => void,
): Promise<void> {
  const stale = items.filter((i) => i.generatedAudioKey)
  if (stale.length === 0) return

  log.debug(`Resolving ${stale.length} generated audio item(s)`)
  for (const item of stale) {
    const freshUrl = await loadGeneratedAudioUrl(item.generatedAudioKey!)
    if (freshUrl) {
      updateItemSrc(item.id, freshUrl)
      log.debug('Resolved audio', item.id, '←', item.generatedAudioKey)
    } else {
      log.warn('Generated audio not found in OPFS for item', item.id, item.generatedAudioKey)
    }
  }
}
