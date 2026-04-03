const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 12;

export function generateSessionId(): string {
  let id = '';
  const cryptoObj = (typeof crypto !== 'undefined' ? crypto : null) as
    | (Crypto & { getRandomValues<T extends ArrayBufferView>(array: T): T })
    | null;

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(ID_LENGTH);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return id;
  }

  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    id += ALPHABET[idx];
  }

  return id;
}
