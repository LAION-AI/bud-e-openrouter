/** Decimal MB, matching the upload UI. Base64 adds about one third on the wire. */
export const MAX_PDF_BYTES = 20_000_000;
export const MAX_PDF_BASE64 = Math.ceil(MAX_PDF_BYTES / 3) * 4;
export const MAX_ROOM_REQUEST_BYTES = 32_000_000;
export const MAX_GRADING_TOTAL_BYTES = 40_000_000;

export function base64Bytes(value: string): number {
  return value.length / 4 * 3 -
    (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}
/** Check decoded size too: 20 MB and 20 MB + 1 byte can have equal encoded lengths. */
export function validPdfBase64(value: unknown): value is string {
  if (
    typeof value !== "string" || !value.length ||
    value.length > MAX_PDF_BASE64 ||
    value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)
  ) return false;
  const padding = value.indexOf("=");
  if (
    padding !== -1 &&
    (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding)))
  ) return false;
  return base64Bytes(value) <= MAX_PDF_BYTES;
}
