import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, Square, Loader2, X, Wand2, Captions, AudioLines } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { transcribeAudio } from '../services/audio-transcriber'
import type { GeminiVoice } from '../services/gemini-tts'
import { useTimelineStore } from '@/features/ai-chat/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/ai-chat/deps/timeline-utils'
import { addItem } from '@/features/ai-chat/deps/timeline-actions'
import type { AudioItem, TextItem } from '@/types/timeline'

const VOICES: GeminiVoice[] = ['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir', 'Zephyr']

type Stage = 'idle' | 'recording' | 'processing' | 'review'

interface VoiceRecorderProps {
  onClose: () => void
  /** Timeline frame where placed audio/captions should start */
  placementFrame?: number
}

function useRecordingTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  const fmt = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return fmt
}

export function VoiceRecorder({ onClose, placementFrame = 0 }: VoiceRecorderProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [selectedVoice, setSelectedVoice] = useState<GeminiVoice>('Kore')
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioBlobRef = useRef<Blob | null>(null)

  const timer = useRecordingTimer(stage === 'recording')

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        audioBlobRef.current = blob
        setAudioBlobUrl(URL.createObjectURL(blob))
        setStage('processing')
        try {
          const result = await transcribeAudio(blob)
          setTranscript(result.fullText)
          setStage('review')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed')
          setStage('idle')
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setStage('recording')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied')
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
  }, [])

  const placeRawRecording = useCallback(() => {
    const blob = audioBlobRef.current
    if (!blob) return
    const src = audioBlobUrl ?? URL.createObjectURL(blob)
    const { tracks, items, fps } = useTimelineStore.getState()
    const track = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'audio',
      preferredTrackId: undefined,
    })
    if (!track) {
      setError('No audio track available')
      return
    }
    const durationInFrames = Math.round((blob.size / (24000 * 2)) * fps) // rough estimate
    const from =
      findNearestAvailableSpace(placementFrame, durationInFrames, track.id, items) ?? placementFrame
    const audioItem: AudioItem = {
      id: crypto.randomUUID(),
      type: 'audio',
      trackId: track.id,
      from,
      durationInFrames,
      label: 'Voice recording',
      src,
    }
    addItem(audioItem)
    onClose()
  }, [audioBlobUrl, placementFrame, onClose])

  const addCaptionsFromTranscript = useCallback(async () => {
    if (!transcript) return
    setStage('processing')
    try {
      const blob = audioBlobRef.current
      if (!blob) throw new Error('No audio blob')
      const result = await transcribeAudio(blob)
      const { tracks, items, fps } = useTimelineStore.getState()
      const textTrack = findCompatibleTrackForItemType({
        tracks,
        items,
        itemType: 'text',
        preferredTrackId: undefined,
      })
      if (!textTrack) throw new Error('No text track available')
      for (const seg of result.segments) {
        const from = placementFrame + Math.round(seg.startSec * fps)
        const dur = Math.max(Math.round(fps * 0.75), Math.round((seg.endSec - seg.startSec) * fps))
        const { items: i2, tracks: t2 } = useTimelineStore.getState()
        const track2 = findCompatibleTrackForItemType({
          tracks: t2,
          items: i2,
          itemType: 'text',
          preferredTrackId: undefined,
        })
        if (!track2) break
        const finalFrom = findNearestAvailableSpace(from, dur, track2.id, i2) ?? from
        const textItem: TextItem = {
          id: crypto.randomUUID(),
          type: 'text',
          trackId: track2.id,
          from: finalFrom,
          durationInFrames: dur,
          label: seg.text.slice(0, 40),
          originId: crypto.randomUUID(),
          text: seg.text,
          textRole: 'caption',
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
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add captions')
      setStage('review')
    }
  }, [transcript, placementFrame, onClose])

  const convertToAiVoice = useCallback(async () => {
    if (!transcript) return
    setStage('processing')
    try {
      const { getTool } = await import('../tools/tool-registry')
      await import('../tools/init-tools')
      const tool = getTool('add_voiceover')
      if (!tool) throw new Error('add_voiceover tool not found')
      await tool.handler({ text: transcript, fromFrame: placementFrame })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI voice generation failed')
      setStage('review')
    }
  }, [transcript, selectedVoice, placementFrame, onClose])

  return (
    <div className="border border-border rounded-lg bg-background shadow-lg p-3 space-y-3 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Mic className="h-3.5 w-3.5 text-primary" />
          Voice Studio
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Recording controls */}
      {(stage === 'idle' || stage === 'recording') && (
        <div className="flex flex-col items-center gap-3 py-2">
          <button
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-full transition-all',
              stage === 'recording'
                ? 'bg-red-500/20 ring-2 ring-red-500 animate-pulse cursor-pointer'
                : 'bg-primary/10 hover:bg-primary/20 cursor-pointer',
            )}
            onClick={stage === 'recording' ? stopRecording : startRecording}
          >
            {stage === 'recording' ? (
              <Square className="h-5 w-5 text-red-500 fill-red-500" />
            ) : (
              <Mic className="h-5 w-5 text-primary" />
            )}
          </button>
          <span className="text-xs text-muted-foreground font-mono">
            {stage === 'recording' ? timer : 'Tap to record'}
          </span>
        </div>
      )}

      {/* Processing */}
      {stage === 'processing' && (
        <div className="flex flex-col items-center gap-2 py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">Transcribing...</span>
        </div>
      )}

      {/* Review */}
      {stage === 'review' && (
        <div className="space-y-3">
          {/* Transcript preview */}
          <div className="rounded-md border border-border bg-secondary/30 p-2">
            <p className="text-xs text-muted-foreground mb-1">Transcript</p>
            <p className="text-sm leading-relaxed">{transcript || '(no speech detected)'}</p>
          </div>

          {/* Audio preview */}
          {audioBlobUrl && (
            <audio src={audioBlobUrl} controls className="w-full h-8" style={{ height: 28 }} />
          )}

          {/* Voice selector (for AI conversion) */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">AI voice</p>
            <div className="flex flex-wrap gap-1">
              {VOICES.map((v) => (
                <button
                  key={v}
                  onClick={() => setSelectedVoice(v)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs transition-colors',
                    selectedVoice === v
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/50 text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5">
            <Button size="sm" className="h-8 gap-1.5 justify-start" onClick={convertToAiVoice}>
              <Wand2 className="h-3.5 w-3.5" />
              Convert to AI voice + captions
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5 justify-start"
              onClick={addCaptionsFromTranscript}
            >
              <Captions className="h-3.5 w-3.5" />
              Add captions only
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 justify-start text-muted-foreground"
              onClick={placeRawRecording}
            >
              <AudioLines className="h-3.5 w-3.5" />
              Place recording as-is
            </Button>
          </div>

          {/* Re-record */}
          <button
            className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
            onClick={() => {
              setStage('idle')
              setTranscript('')
              setAudioBlobUrl(null)
              audioBlobRef.current = null
            }}
          >
            Record again
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive rounded border border-destructive/30 bg-destructive/10 px-2 py-1">
          {error}
        </p>
      )}
    </div>
  )
}
