/**
 * lib/fingerprint.ts
 * SHA-256 device fingerprint from stable browser signals.
 * Returns a hex string; falls back to a random localStorage ID if SubtleCrypto unavailable.
 */
export async function getFingerprint(): Promise<string> {
  const STORAGE_KEY = 'pulse_fp';
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) return cached;

  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency ?? 0,
  ].join('|');

  let fp: string;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    fp = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    fp = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  localStorage.setItem(STORAGE_KEY, fp);
  return fp;
}
