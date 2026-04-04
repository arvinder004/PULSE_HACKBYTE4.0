/**
 * Transcribe an audio buffer using Gemini Flash's multimodal audio input.
 * Sends the audio as inline base64 — no file upload step needed.
 * Free tier: 15 RPM / 1500 RPD on gemini-3-flash-preview.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm'
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[PULSE][Gemini-STT] ✗ no GEMINI_API_KEY');
    return null;
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
  console.log('[PULSE][Gemini-STT] ▶ sending', audioBuffer.length, 'bytes to', model, 'mimeType:', mimeType);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const base64Audio = audioBuffer.toString('base64');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Audio,
            },
          },
          {
            text: 'Transcribe this audio exactly as spoken. Return only the transcript text, no labels, no timestamps, no commentary. If the audio is silent or inaudible, return an empty string.',
          },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null) as any;

    if (!res.ok) {
      console.log('[PULSE][Gemini-STT] ✗ HTTP', res.status, json?.error?.message ?? JSON.stringify(json));
      return null;
    }

    const text: string = json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text)
      .filter(Boolean)
      .join(' ')
      .trim() ?? '';

    console.log('[PULSE][Gemini-STT] ✓ transcribed', text.length, 'chars |', text.slice(0, 100));
    return text || null;
  } catch (e: any) {
    console.log('[PULSE][Gemini-STT] ✗ fetch error', e?.message || e);
    return null;
  }
}
