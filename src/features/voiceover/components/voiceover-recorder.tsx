import { useCallback, useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'
import { toast } from 'sonner'
import { usePlaybackStore } from '@/shared/state/playback'
import { createLogger } from '@/shared/logging/logger'
import type { AudioItem } from '@/types/timeline'
import {
  addItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  useTimelineStore,
} from '../deps/timeline-contract'
import { importMediaLibraryService, useMediaLibraryStore } from '../deps/media-library-contract'

const log = createLogger('voiceover-recorder')

type Stage = 'countdown' | 'recording' | 'saving'

interface VoiceoverRecorderProps {
  startFrame: number
  fps: number
  onClose: () => void
}

export function VoiceoverRecorder({ startFrame, fps, onClose }: VoiceoverRecorderProps) {
  const [stage, setStage] = useState<Stage>('countdown')
  const [countdown, setCountdown] = useState(3)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [micError, setMicError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  const commitStop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorderRef.current = null
    const durationMs = Date.now() - startTimeRef.current
    setStage('saving')
    usePlaybackStore.getState().pause()

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop())
      try {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
        const file = new File([blob], `voiceover-recording.${ext}`, {
          type: mimeType,
          lastModified: Date.now(),
        })

        const projectId = useMediaLibraryStore.getState().currentProjectId
        if (!projectId) throw new Error('No project open')

        // Persist to workspace so it survives session reload
        const { mediaLibraryService } = await importMediaLibraryService()
        const savedMedia = await mediaLibraryService.importGeneratedAudio(file, projectId, {
          tags: ['voiceover-recording'],
        })
        useMediaLibraryStore.getState().prependMediaItem(savedMedia)

        const durationFrames = Math.max(
          1,
          Math.round((savedMedia.duration ?? durationMs / 1000) * fps),
        )

        const { tracks, items } = useTimelineStore.getState()
        const audioTrack = findCompatibleTrackForItemType({
          tracks,
          items,
          itemType: 'audio',
          preferredTrackId: undefined,
        })
        if (!audioTrack) throw new Error('No audio track available')

        const from =
          findNearestAvailableSpace(startFrame, durationFrames, audioTrack.id, items) ?? startFrame

        const itemId = crypto.randomUUID()
        const audioItem: AudioItem = {
          id: itemId,
          type: 'audio',
          trackId: audioTrack.id,
          from,
          durationInFrames: durationFrames,
          label: 'Voice recording',
          mediaId: savedMedia.id,
          originId: crypto.randomUUID(),
          src: URL.createObjectURL(blob),
        }
        addItem(audioItem)
        toast.success('Voice recording saved and added to timeline')
        onCloseRef.current()
      } catch (err) {
        log.error('Failed to save voiceover recording', err)
        toast.error(err instanceof Error ? err.message : 'Failed to save recording')
        onCloseRef.current()
      }
    }
    recorder.stop()
  }, [fps, startFrame])

  // Countdown 3 → 2 → 1 → 0 → start recording
  useEffect(() => {
    if (stage !== 'countdown') return
    if (countdown === 0) {
      async function beginRecording() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const recorder = new MediaRecorder(stream)
          chunksRef.current = []
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data)
          }
          recorderRef.current = recorder
          recorder.start()
          startTimeRef.current = Date.now()
          setStage('recording')
          usePlaybackStore.getState().play()
        } catch (err) {
          log.warn('Microphone access denied', err)
          setMicError(err instanceof Error ? err.message : 'Microphone access denied')
          window.setTimeout(() => onCloseRef.current(), 2500)
        }
      }
      void beginRecording()
      return
    }
    const tid = window.setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(tid)
  }, [stage, countdown])

  // Auto-stop when playback stops (timeline reached end)
  useEffect(() => {
    if (stage === 'recording' && !isPlaying) {
      commitStop()
    }
  }, [isPlaying, stage, commitStop])

  // Elapsed-time ticker while recording
  useEffect(() => {
    if (stage !== 'recording') return
    timerRef.current = window.setInterval(
      () => setElapsedMs(Date.now() - startTimeRef.current),
      100,
    )
    return () => window.clearInterval(timerRef.current)
  }, [stage])

  const secs = Math.floor(elapsedMs / 1000)
  const cents = Math.floor((elapsedMs % 1000) / 10)
  const timerLabel = `${String(secs).padStart(2, '0')}:${String(cents).padStart(2, '0')}`

  if (micError) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
        <p className="bg-destructive/90 text-destructive-foreground text-sm px-4 py-2.5 rounded-lg max-w-xs text-center">
          {micError}
        </p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {stage === 'countdown' && (
        <div className="absolute inset-0 pointer-events-auto flex flex-col items-center justify-center bg-black/55">
          <div className="flex flex-col items-center gap-3 select-none">
            <span className="text-[7rem] font-bold leading-none text-white tabular-nums drop-shadow-2xl">
              {countdown}
            </span>
            <span className="text-white/60 text-xs tracking-[0.25em] uppercase">recording in…</span>
          </div>
          <button
            className="absolute top-3 right-3 text-white/50 hover:text-white text-xs transition-colors cursor-pointer"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      )}

      {stage === 'recording' && (
        <div className="absolute top-2.5 left-2.5 pointer-events-auto flex items-center gap-2 bg-black/80 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-xl">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-red-400 text-[10px] font-semibold tracking-[0.2em] uppercase">
            REC
          </span>
          <span className="text-white text-[11px] font-mono tabular-nums">{timerLabel}</span>
          <div className="w-px h-3 bg-white/20 mx-0.5 flex-shrink-0" />
          <button
            onClick={commitStop}
            className="flex items-center gap-1 text-white/70 hover:text-white text-[10px] transition-colors cursor-pointer"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop
          </button>
        </div>
      )}

      {stage === 'saving' && (
        <div className="absolute top-2.5 left-2.5 pointer-events-auto flex items-center gap-2 bg-black/80 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-xl">
          <span className="text-white/60 text-[11px]">Saving recording…</span>
        </div>
      )}
    </div>
  )
}
