export async function generateVoiceoverCartesia(
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<Blob> {
  const response = await fetch('/api/cartesia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cartesia-Api-Key': apiKey,
    },
    body: JSON.stringify({
      model_id: 'sonic-2',
      transcript: text,
      voice: { mode: 'id', id: voiceId },
      output_format: {
        container: 'wav',
        encoding: 'pcm_f32le',
        sample_rate: 44100,
      },
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Cartesia TTS error ${response.status}: ${errText}`)
  }

  return response.blob()
}
