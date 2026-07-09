const ALGO = 'AES-GCM';
const KEY_STORAGE = 'fill_a_form_enc_key';

async function getOrCreateKey() {
  const stored = await chrome.storage.local.get(KEY_STORAGE);
  if (stored[KEY_STORAGE]) {
    const raw = base64ToBuffer(stored[KEY_STORAGE]);
    return crypto.subtle.importKey('raw', raw, ALGO, false, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: ALGO, length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.local.set({ [KEY_STORAGE]: bufferToBase64(exported) });
  return key;
}

export async function encryptData(plaintext) {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  return {
    iv: bufferToBase64(iv),
    data: bufferToBase64(ciphertext),
  };
}

export async function decryptData({ iv, data }) {
  const key = await getOrCreateKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv: base64ToBuffer(iv) },
    key,
    base64ToBuffer(data)
  );
  return new TextDecoder().decode(decrypted);
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
