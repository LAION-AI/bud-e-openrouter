/** Browser-side encryption. Passwords and data keys never leave this module's caller. */
// v1 format parameter: changing this in-place would lock existing users out.
export const PERSONAL_KDF_ITERATIONS = 600_000;
export const PERSONAL_QUOTA = 100 * 1024 * 1024;
export const PERSONAL_MAX_OBJECT = 2 * 1024 * 1024;
const encoder = new TextEncoder();
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex)) {
    throw new Error("Ungültige Verschlüsselungsdaten.");
  }
  return Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16));
}
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(text);
}
export function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) {
    throw new Error("Ungültige verschlüsselte Datei.");
  }
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
export async function personalKeys(
  password: string,
  slug: string,
  salt: string,
): Promise<{ key: CryptoKey; auth: string }> {
  if (!/^[a-f0-9]{32}$/.test(salt)) {
    throw new Error("Ungültiges Schlüssel-Salz.");
  }
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: fromHex(salt),
        iterations: PERSONAL_KDF_ITERATIONS,
      },
      passwordKey,
      256,
    ),
  );
  const root = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  bits.fill(0);
  const parameters = {
    name: "HKDF",
    hash: "SHA-256",
    salt: encoder.encode("bud-e.personal.v1:" + slug),
  };
  const key = await crypto.subtle.deriveKey(
    { ...parameters, info: encoder.encode("storage") },
    root,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const auth = toHex(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { ...parameters, info: encoder.encode("authentication") },
        root,
        256,
      ),
    ),
  );
  return { key, auth };
}
/** Each object is independently authenticated, including its room and object ID. */
export async function encryptPersonal(
  key: CryptoKey,
  slug: string,
  id: string,
  value: unknown,
): Promise<Uint8Array> {
  const raw = encoder.encode(JSON.stringify(value));
  if (raw.length > 8 * 1024 * 1024) {
    throw new Error(
      "Dieser Verlauf ist zu groß. Bitte einen neuen Chat beginnen.",
    );
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(`bud-e.personal.v1:${slug}:${id}`),
      },
      key,
      compressed,
    ),
  );
  const packed = new Uint8Array(13 + cipher.length);
  packed[0] = 1;
  packed.set(iv, 1);
  packed.set(cipher, 13);
  if (packed.length > PERSONAL_MAX_OBJECT) {
    throw new Error(
      "Die verschlüsselte Datei ist zu groß. Bitte den Verlauf exportieren und einen neuen Chat beginnen.",
    );
  }
  return packed;
}
export async function decryptPersonal<T>(
  key: CryptoKey,
  slug: string,
  id: string,
  packed: Uint8Array,
): Promise<T> {
  if (
    packed.length < 29 || packed.length > PERSONAL_MAX_OBJECT || packed[0] !== 1
  ) throw new Error("Ungültige verschlüsselte Datei.");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: packed.slice(1, 13),
        additionalData: encoder.encode(`bud-e.personal.v1:${slug}:${id}`),
      },
      key,
      packed.slice(13),
    );
  } catch {
    throw new Error(
      "Die Daten lassen sich mit diesem Passwort nicht öffnen oder wurden verändert.",
    );
  }
  const stream = new Blob([plain]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  const reader = stream.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 8 * 1024 * 1024) {
        throw new Error("Entschlüsselter Verlauf zu groß.");
      }
      parts.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return JSON.parse(await new Blob(parts).text()) as T;
}
