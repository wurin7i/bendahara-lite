const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** ID pendek acak, mis. "agt_k3j9x0q2ab". */
export function newId(prefix) {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
