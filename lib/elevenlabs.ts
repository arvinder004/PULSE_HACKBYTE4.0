type ElevenLabsResult = {
  audioBuffer: Buffer;
  contentType: string;
};

type ElevenLabsTranscript = {
  text: string;
  raw?: any;
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

export async function transcribeSpeech(audioBuffer: Buffer, contentType: string, filename: string): Promise<ElevenLabsTranscript> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');

  const url = process.env.ELEVENLABS_STT_URL || 'https://api.elevenlabs.io/v1/speech-to-text';
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: contentType || 'audio/webm' });
  form.append('file', blob, filename);

  if (process.env.ELEVENLABS_STT_MODEL) {
    form.append('model_id', process.env.ELEVENLABS_STT_MODEL);
  }
  if (process.env.ELEVENLABS_STT_LANGUAGE) {
    form.append('language_code', process.env.ELEVENLABS_STT_LANGUAGE);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      Accept: 'application/json',
    },
    body: form as any,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs STT error: ${res.status} ${errText}`);
  }

  const json = await res.json().catch(() => null) as any;
  const text = String(json?.text || json?.transcript || json?.data?.text || '');
  return { text, raw: json };
}
