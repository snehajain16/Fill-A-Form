export async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin, hash) {
  return (await hashPin(pin)) === hash;
}
