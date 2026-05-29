import { useSettingsStore } from '@/features/editor/deps/settings'
import { generateVoiceover } from './gemini-tts'
import { generateVoiceoverCartesia } from './cartesia-tts'

export async function generateTtsAudio(text: string): Promise<Blob> {
  const { aiVoiceProvider, geminiTtsVoice, cartesiaApiKey, cartesiaVoiceId } =
    useSettingsStore.getState()

  if (aiVoiceProvider === 'cartesia') {
    if (!cartesiaApiKey || !cartesiaVoiceId) {
      throw new Error(
        'Cartesia API key and Voice ID are required. Configure them in Settings → AI.',
      )
    }
    return generateVoiceoverCartesia(text, cartesiaApiKey, cartesiaVoiceId)
  }

  return generateVoiceover(text, geminiTtsVoice)
}
