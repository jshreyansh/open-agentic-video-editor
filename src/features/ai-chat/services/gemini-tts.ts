function parseSampleRate(mimeType: string): number | null {
  const m = mimeType.match(/rate=(\d+)/)
  return m?.[1] ? parseInt(m[1], 10) : null
}

function buildWavHeader(pcmByteLength: number, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const buffer = new ArrayBuffer(44)
  const view = new DataView(buffer)
  const enc = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }
  enc(0, 'RIFF')
  view.setUint32(4, 36 + pcmByteLength, true)
  enc(8, 'WAVE')
  enc(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  enc(36, 'data')
  view.setUint32(40, pcmByteLength, true)
  return buffer
}

// Gemini TTS voices available on Vertex AI
export type GeminiVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede' | 'Orbit' | 'Zephyr'

export const GEMINI_VOICES: { name: GeminiVoice; description: string }[] = [
  { name: 'Puck', description: 'Upbeat, clear (male)' },
  { name: 'Charon', description: 'Deep, authoritative (male)' },
  { name: 'Kore', description: 'Warm, friendly (female)' },
  { name: 'Fenrir', description: 'Confident, energetic (male)' },
  { name: 'Aoede', description: 'Smooth, professional (female)' },
  { name: 'Orbit', description: 'Bright, approachable (neutral)' },
  { name: 'Zephyr', description: 'Calm, soothing (neutral)' },
]

interface TtsApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string }
      }>
    }
  }>
  error?: { message?: string; code?: number }
}

export async function generateVoiceover(text: string, voice: GeminiVoice = 'Kore'): Promise<Blob> {
  const response = await fetch('/api/gemini?model=gemini-2.5-flash-preview-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    }),
  })

  const data = (await response.json()) as TtsApiResponse

  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `TTS error ${response.status}`)
  }

  const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!inlineData?.data) {
    throw new Error('No audio data in TTS response')
  }

  const mimeType = inlineData.mimeType ?? 'audio/wav'
  const binary = atob(inlineData.data)
  const pcmBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    pcmBytes[i] = binary.charCodeAt(i)
  }

  // Gemini TTS returns raw L16 PCM (audio/L16;codec=pcm;rate=24000).
  // Wrap it in a WAV container so browsers can decode it.
  if (mimeType.includes('L16') || mimeType.includes('pcm')) {
    const sampleRate = parseSampleRate(mimeType) ?? 24000
    return new Blob([buildWavHeader(pcmBytes.length, sampleRate), pcmBytes], { type: 'audio/wav' })
  }

  return new Blob([pcmBytes], { type: mimeType })
}
