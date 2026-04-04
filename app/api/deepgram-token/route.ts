import { NextResponse } from 'next/server';

/**
 * Returns a short-lived Deepgram temporary token so the API key
 * never has to be exposed in the browser.
 */
export async function GET() {
  const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing-deepgram-key' }, { status: 500 });
  }

  try {
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ time_to_live_in_seconds: 60 }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[PULSE][Deepgram] token grant failed', res.status, text);
      return NextResponse.json({ error: 'token-grant-failed' }, { status: 502 });
    }

    const data = await res.json();
    // Deepgram returns `access_token` (JWT) and `expires_in`
    return NextResponse.json({ token: data.access_token });
  } catch (e: any) {
    console.error('[PULSE][Deepgram] token grant error', e?.message);
    return NextResponse.json({ error: 'token-grant-error' }, { status: 500 });
  }
}
