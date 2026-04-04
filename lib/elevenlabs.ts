type ElevenLabsResult = {
  audioBuffer: Buffer;
  contentType: string;
};

export async function synthesizeSpeech(text: string, voiceId?: string): Promise<ElevenLabsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');
  if (!vid) throw new Error('ELEVENLABS_VOICE_ID missing');

  const model = process.env.ELEVENLABS_MODEL || 'eleven_monolingual_v1';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.7,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error: ${res.status} ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { audioBuffer: Buffer.from(arrayBuffer), contentType: 'audio/mpeg' };
}
