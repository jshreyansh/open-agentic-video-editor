import { createLogger } from '@/shared/logging/logger'

const log = createLogger('ai-chat:audio-transcriber')

export interface TranscribedSegment {
  text: string
  startSec: number
  endSec: number
}

export interface TranscriptionResult {
  fullText: string
  segments: TranscribedSegment[]
}

// Convert a Blob to base64 without stack overflow on large files.
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

// Send an audio blob to Gemini for word-level transcription.
// Returns full text + timestamped segments (each ≤ 10 words).
export async function transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
  const base64 = await blobToBase64(audioBlob)
  const mimeType = audioBlob.type || 'audio/webm'

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            {
              text: `Transcribe this audio exactly as spoken. Return ONLY valid JSON matching this structure:
{
  "fullText": "complete transcript here",
  "segments": [
    { "text": "first caption phrase", "startSec": 0.0, "endSec": 2.5 },
    { "text": "next phrase", "startSec": 2.5, "endSec": 5.1 }
  ]
}
Rules: keep each segment under 10 words, be precise with timing, no markdown outside the JSON object.`,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const err = (await response.json()) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `Transcription API error ${response.status}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  try {
    const match = rawText.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? rawText) as Partial<TranscriptionResult>
    return {
      fullText: parsed.fullText ?? rawText,
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    }
  } catch {
    log.warn('Transcription JSON parse failed, returning plain text')
    return { fullText: rawText, segments: [] }
  }
}
