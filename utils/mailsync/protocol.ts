/**
 * @file protocol.ts
 * @description The on-the-wire format BUD-E uses inside the mailbox.
 *
 *              A snapshot is one JSON document (all chats plus their inline
 *              media). It is gzipped, split into chunks that comfortably fit
 *              a normal mail size limit, and each chunk becomes one mail whose
 *              subject starts with the marker below.
 *
 *              Everything a client needs to reassemble a snapshot lives in
 *              X-BudE-* headers; the subject repeats it in readable form so
 *              the mailbox is still understandable in any mail client.
 */

/**
 * The mailbox can hold two kinds of item, told apart by the subject marker:
 * full state snapshots and the API key ring. Both use the identical transport
 * (gzip, chunking, X-BudE-* headers) and simply live in the same folder.
 */
export const SUBJECT_MARKERS = {
  memory: "[BUD-E Memory]",
  keys: "[BUD-E Keys]",
} as const;

export type SnapshotKind = keyof typeof SUBJECT_MARKERS;

/** Default marker, kept as its own export for readability at call sites. */
export const SUBJECT_MARKER = SUBJECT_MARKERS.memory;

export function markerFor(kind: SnapshotKind): string {
  return SUBJECT_MARKERS[kind] ?? SUBJECT_MARKERS.memory;
}

export const SNAPSHOT_VERSION = 1;

/** Header names, lower-cased the way IMAP hands them back to us. */
export const H = {
  version: "x-bude-snapshot",
  id: "x-bude-id",
  created: "x-bude-created",
  label: "x-bude-label",
  device: "x-bude-device",
  part: "x-bude-part",
  parts: "x-bude-parts",
  chunkBytes: "x-bude-chunk-bytes",
  totalBytes: "x-bude-total-bytes",
  rawBytes: "x-bude-raw-bytes",
} as const;

/** The header fields we ask the IMAP server for when listing. */
export const LIST_HEADER_FIELDS = [
  "SUBJECT",
  "DATE",
  "X-BUDE-SNAPSHOT",
  "X-BUDE-ID",
  "X-BUDE-CREATED",
  "X-BUDE-LABEL",
  "X-BUDE-DEVICE",
  "X-BUDE-PART",
  "X-BUDE-PARTS",
  "X-BUDE-CHUNK-BYTES",
  "X-BUDE-TOTAL-BYTES",
  "X-BUDE-RAW-BYTES",
];

/** One mail belonging to a snapshot. */
export interface SnapshotPart {
  uid: number;
  part: number;
  parts: number;
  size: number;
}

/** A snapshot as presented to the UI. */
export interface SnapshotSummary {
  id: string;
  created: string;
  label: string;
  device: string;
  parts: number;
  /** UIDs in part order; missing parts show up as gaps */
  uids: number[];
  /** gzipped size in bytes */
  totalBytes: number;
  /** uncompressed size in bytes */
  rawBytes: number;
  /** false when at least one part mail is missing */
  complete: boolean;
  subject: string;
}

/** Builds the mail subject for one chunk. */
export function buildSubject(
  created: string,
  label: string,
  id: string,
  part: number,
  parts: number,
  kind: SnapshotKind = "memory",
): string {
  const stamp = created.replace("T", " ").replace(/\.\d+Z$/, "Z").replace(
    "Z",
    " UTC",
  );
  const partSuffix = parts > 1 ? ` | ${part}/${parts}` : "";
  return `${markerFor(kind)} ${stamp} | ${label} | id=${id}${partSuffix}`;
}

/** Splits gzipped bytes into chunks of at most `chunkSize`. */
export function chunkBytes(data: Uint8Array, chunkSize: number): Uint8Array[] {
  if (data.length <= chunkSize) return [data];
  const out: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += chunkSize) {
    out.push(data.subarray(off, Math.min(off + chunkSize, data.length)));
  }
  return out;
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Concatenates chunk buffers back into the full gzip stream. */
export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Groups fetched header sets into snapshots.
 * Mails that do not carry our headers are ignored, so an unrelated mail whose
 * subject happens to contain the marker cannot break a restore.
 */
export function groupSnapshots(
  headers: { uid: number; size: number; headers: Record<string, string> }[],
  decodeHeader: (v: string) => string,
): SnapshotSummary[] {
  const byId = new Map<string, SnapshotSummary & { seen: Map<number, number> }>();

  for (const entry of headers) {
    const h = entry.headers;
    const id = h[H.id]?.trim();
    if (!id) continue;

    const parts = Math.max(1, Number(h[H.parts] ?? "1") || 1);
    const part = Math.max(1, Number(h[H.part] ?? "1") || 1);

    let snap = byId.get(id);
    if (!snap) {
      snap = {
        id,
        created: h[H.created]?.trim() || h["date"]?.trim() || "",
        label: decodeHeader(h[H.label] ?? "").trim() || "Snapshot",
        device: decodeHeader(h[H.device] ?? "").trim(),
        parts,
        uids: [],
        totalBytes: Number(h[H.totalBytes] ?? "0") || 0,
        rawBytes: Number(h[H.rawBytes] ?? "0") || 0,
        complete: false,
        subject: decodeHeader(h["subject"] ?? ""),
        seen: new Map(),
      };
      byId.set(id, snap);
    }
    snap.parts = Math.max(snap.parts, parts);
    snap.seen.set(part, entry.uid);
  }

  const out: SnapshotSummary[] = [];
  for (const snap of byId.values()) {
    const uids: number[] = [];
    let complete = true;
    for (let p = 1; p <= snap.parts; p++) {
      const uid = snap.seen.get(p);
      if (uid === undefined) {
        complete = false;
        continue;
      }
      uids.push(uid);
    }
    const { seen: _seen, ...rest } = snap;
    out.push({ ...rest, uids, complete });
  }

  // newest first
  out.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
  return out;
}
