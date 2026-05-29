export type CartesiaSpeed = 'slowest' | 'slow' | 'normal' | 'fast' | 'fastest'
export type CartesiaModel = 'sonic-2' | 'sonic-turbo'

export interface CartesiaEmotionPreset {
  label: string
  tags: string[]
}

export const CARTESIA_SPEED_OPTIONS: { value: CartesiaSpeed; label: string }[] = [
  { value: 'slowest', label: 'Slowest' },
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'fastest', label: 'Fastest' },
]

export const CARTESIA_MODEL_OPTIONS: { value: CartesiaModel; label: string }[] = [
  { value: 'sonic-2', label: 'Sonic 2 (high quality)' },
  { value: 'sonic-turbo', label: 'Sonic Turbo (faster)' },
]

// Presets map to Cartesia's __experimental_controls.emotion array
export const CARTESIA_EMOTION_PRESETS: CartesiaEmotionPreset[] = [
  { label: 'None', tags: [] },
  { label: 'Professional', tags: ['positivity:low'] },
  { label: 'Upbeat', tags: ['positivity:high'] },
  { label: 'Energetic', tags: ['positivity:high', 'surprise:low'] },
  { label: 'Empathetic', tags: ['positivity:medium', 'sadness:low'] },
  { label: 'Curious', tags: ['curiosity:high'] },
  { label: 'Calm', tags: ['positivity:low', 'negativity:lowest'] },
  { label: 'Excited', tags: ['positivity:highest', 'surprise:medium'] },
  { label: 'Serious', tags: ['negativity:low', 'anger:lowest'] },
]

export const CARTESIA_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'ru', label: 'Russian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ar', label: 'Arabic' },
]

export interface CartesiaTtsOptions {
  speed?: CartesiaSpeed
  emotionPresetIndex?: number
  language?: string
  model?: CartesiaModel
}

export async function generateSpeechFileCartesia(
  text: string,
  apiKey: string,
  voiceId: string,
  options?: CartesiaTtsOptions,
): Promise<{ blob: Blob; file: File; duration: number }> {
  const speed = options?.speed ?? 'normal'
  const preset = CARTESIA_EMOTION_PRESETS[options?.emotionPresetIndex ?? 0]
  const emotionTags = preset?.tags ?? []
  const language = options?.language && options.language !== 'auto' ? options.language : undefined
  const modelId: CartesiaModel = options?.model ?? 'sonic-2'

  const voiceControls: Record<string, unknown> = {}
  if (speed !== 'normal') voiceControls['speed'] = speed
  if (emotionTags.length > 0) voiceControls['emotion'] = emotionTags

  const response = await fetch('/api/cartesia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cartesia-Api-Key': apiKey,
    },
    body: JSON.stringify({
      model_id: modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId,
        ...(Object.keys(voiceControls).length > 0
          ? { __experimental_controls: voiceControls }
          : {}),
      },
      output_format: {
        container: 'wav',
        encoding: 'pcm_f32le',
        sample_rate: 44100,
      },
      ...(language ? { language } : {}),
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Cartesia TTS failed (${response.status}): ${errText}`)
  }

  const blob = await response.blob()
  const file = new File([blob], 'cartesia-tts.wav', { type: 'audio/wav' })
  return { blob, file, duration: 0 }
}
