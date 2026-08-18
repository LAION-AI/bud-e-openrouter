/**
 * @file mailsync.ts
 * @description Mailbox based sync for BUD-E.
 *
 *              The browser keeps all user data locally. To move that state
 *              between devices without a server side account, the user points
 *              BUD-E at an IMAP mailbox they own. This route is the only part
 *              that talks to that mailbox: the browser sends the credentials
 *              along with each request, the server performs one operation and
 *              forgets them again. Nothing is persisted here.
 *
 *              Actions: test | list | upload | download | delete
 *              Kinds:   memory (chats and media) | keys (the API key ring)
 */

import { Handlers } from "$fresh/server.ts";
import { ImapClient, type ImapConfig } from "../../utils/mailsync/imap.ts";
import { SmtpClient, type SmtpConfig } from "../../utils/mailsync/smtp.ts";
import {
  buildSnapshotMessage,
  decodeHeaderValue,
  extractAttachment,
} from "../../utils/mailsync/mime.ts";
import {
  buildSubject,
  chunkBytes,
  concatChunks,
  groupSnapshots,
  gunzip,
  gzip,
  H,
  LIST_HEADER_FIELDS,
  markerFor,
  SNAPSHOT_VERSION,
  type SnapshotKind,
} from "../../utils/mailsync/protocol.ts";

// ---------------------------------------------------------------- settings

const DEFAULT_FOLDER = "INBOX";

const MAX_SNAPSHOT_BYTES =
  (Number(Deno.env.get("MAILSYNC_MAX_SNAPSHOT_MB")) || 200) * 1024 * 1024;

/** Gzipped bytes per mail. 10 MB stays below the common 25 MB mail limit
 *  once base64 inflates it by a third. */
const CHUNK_BYTES = (Number(Deno.env.get("MAILSYNC_CHUNK_MB")) || 10) * 1024 *
  1024;

/** Set to 1 for local/self-hosted mail servers on non-standard ports. */
const ALLOW_INSECURE_HOSTS = Deno.env.get("MAILSYNC_ALLOW_INSECURE_HOSTS") === "1";

const STANDARD_PORTS = new Set([25, 143, 465, 587, 993, 2525]);
const EXTRA_PORTS = new Set(
  (Deno.env.get("MAILSYNC_EXTRA_PORTS") ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65536),
);

// ------------------------------------------------------------------- types

interface Account {
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapStartTls: boolean;
  imapUser: string;
  imapPass: string;
  folder: string;

  useSmtp: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpStartTls: boolean;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  toAddress: string;
}

class BadRequest extends Error {}

// ------------------------------------------------------------------ guards

function assertAllowedTarget(host: string, port: number, what: string) {
  if (!host) throw new BadRequest(`${what}: no host configured`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BadRequest(`${what}: invalid port ${port}`);
  }
  if (ALLOW_INSECURE_HOSTS) return;

  if (!STANDARD_PORTS.has(port) && !EXTRA_PORTS.has(port)) {
    throw new BadRequest(
      `${what}: port ${port} is not allowed. Set MAILSYNC_EXTRA_PORTS or MAILSYNC_ALLOW_INSECURE_HOSTS=1 on the server.`,
    );
  }
  if (isPrivateHost(host)) {
    throw new BadRequest(
      `${what}: refusing to connect to the private address "${host}". Set MAILSYNC_ALLOW_INSECURE_HOSTS=1 to allow it.`,
    );
  }
}

/**
 * Blocks the obvious loopback/private targets so a public deployment cannot be
 * used to probe its own network. Only literal addresses and localhost names
 * are recognised - a hostname resolving to a private address still gets
 * through, which is why the env switch exists for deliberate self-hosting.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) {
    return true;
  }
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // unique local IPv6
  if (/^fe80:/.test(h)) return true; // link local IPv6

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

/** Header values must not smuggle in extra header lines. */
function headerSafe(value: string, maxLen = 200): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

// --------------------------------------------------------------- normalise

// deno-lint-ignore no-explicit-any
function readAccount(raw: any): Account {
  if (!raw || typeof raw !== "object") {
    throw new BadRequest("no account configuration supplied");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

  const imapTls = raw.imapTls !== false;
  const account: Account = {
    imapHost: str(raw.imapHost),
    imapPort: num(raw.imapPort, imapTls ? 993 : 143),
    imapTls,
    imapStartTls: !!raw.imapStartTls,
    imapUser: str(raw.imapUser),
    imapPass: typeof raw.imapPass === "string" ? raw.imapPass : "",
    folder: str(raw.folder) || DEFAULT_FOLDER,

    useSmtp: !!raw.useSmtp,
    smtpHost: str(raw.smtpHost),
    smtpPort: num(raw.smtpPort, 587),
    smtpTls: !!raw.smtpTls,
    smtpStartTls: raw.smtpStartTls !== false,
    smtpUser: str(raw.smtpUser),
    smtpPass: typeof raw.smtpPass === "string" ? raw.smtpPass : "",
    fromAddress: str(raw.fromAddress),
    toAddress: str(raw.toAddress),
  };

  if (!account.imapHost) throw new BadRequest("IMAP host is missing");
  if (!account.imapUser) throw new BadRequest("IMAP user is missing");
  if (/[\r\n]/.test(account.folder)) throw new BadRequest("invalid folder name");
  assertAllowedTarget(account.imapHost, account.imapPort, "IMAP");

  if (account.useSmtp) {
    if (!account.smtpHost) throw new BadRequest("SMTP host is missing");
    assertAllowedTarget(account.smtpHost, account.smtpPort, "SMTP");
    if (!account.fromAddress || !account.toAddress) {
      throw new BadRequest("SMTP needs a sender and a recipient address");
    }
  }
  return account;
}

function imapConfig(a: Account): ImapConfig {
  return {
    host: a.imapHost,
    port: a.imapPort,
    tls: a.imapTls,
    starttls: a.imapStartTls,
    user: a.imapUser,
    pass: a.imapPass,
  };
}

function smtpConfig(a: Account): SmtpConfig {
  return {
    host: a.smtpHost,
    port: a.smtpPort,
    tls: a.smtpTls,
    starttls: a.smtpStartTls,
    user: a.smtpUser || a.imapUser,
    pass: a.smtpPass || a.imapPass,
  };
}

async function withImap<T>(
  account: Account,
  fn: (client: ImapClient) => Promise<T>,
): Promise<T> {
  const client = await ImapClient.connect(imapConfig(account));
  try {
    await client.login();
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function searchCriteria(kind: SnapshotKind): string {
  return `HEADER SUBJECT "${markerFor(kind)}"`;
}

/** Only these two are accepted from the request. */
function readKind(raw: unknown): SnapshotKind {
  return raw === "keys" ? "keys" : "memory";
}

// ----------------------------------------------------------------- actions

async function actionTest(account: Account) {
  const info = await withImap(account, async (client) => {
    await client.ensureFolder(account.folder);
    await client.select(account.folder);
    const uids = await client.searchUids(searchCriteria("memory"));
    const keyUids = await client.searchUids(searchCriteria("keys"));
    return {
      capabilities: client.capabilities,
      snapshotMails: uids.length,
      keyMails: keyUids.length,
    };
  });

  let smtp: string | null = null;
  if (account.useSmtp) {
    const client = await SmtpClient.connect(smtpConfig(account));
    try {
      await client.login();
      smtp = "ok";
    } finally {
      await client.quit();
    }
  }
  return { ok: true, folder: account.folder, ...info, smtp };
}

async function actionList(account: Account, kind: SnapshotKind) {
  const snapshots = await withImap(account, async (client) => {
    await client.ensureFolder(account.folder);
    await client.select(account.folder);
    const uids = await client.searchUids(searchCriteria(kind));
    if (uids.length === 0) return [];
    const headers = await client.fetchHeaders(uids, LIST_HEADER_FIELDS);
    return groupSnapshots(headers, decodeHeaderValue);
  });
  return { ok: true, snapshots };
}

async function actionUpload(
  account: Account,
  snapshotJson: Uint8Array,
  label: string,
  device: string,
  kind: SnapshotKind,
) {
  if (snapshotJson.length === 0) {
    throw new BadRequest("snapshot is empty");
  }
  if (snapshotJson.length > MAX_SNAPSHOT_BYTES) {
    throw new BadRequest(
      `snapshot is ${mb(snapshotJson.length)} MB, the limit is ${
        mb(MAX_SNAPSHOT_BYTES)
      } MB`,
    );
  }

  const packed = await gzip(snapshotJson);
  const chunks = chunkBytes(packed, CHUNK_BYTES);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const created = new Date();
  const createdIso = created.toISOString();
  const safeLabel = headerSafe(label || "Snapshot", 120);
  const safeDevice = headerSafe(device || "", 80);
  const from = account.fromAddress || account.imapUser;
  const to = account.toAddress || account.imapUser;

  const messages = chunks.map((chunk, i) => {
    const part = i + 1;
    const humanText = [
      kind === "keys" ? "BUD-E API key ring" : "BUD-E snapshot",
      `Created: ${createdIso}`,
      `Label:   ${safeLabel}`,
      safeDevice ? `Device:  ${safeDevice}` : "",
      `ID:      ${id}`,
      `Part:    ${part} of ${chunks.length}`,
      `Size:    ${mb(packed.length)} MB compressed, ${
        mb(snapshotJson.length)
      } MB raw`,
      "",
      kind === "keys"
        ? "The attachment holds the API keys stored from a BUD-E browser."
        : "The attachment is one chunk of a gzipped JSON export of all chats,",
      kind === "keys"
        ? "Anyone who can read this mailbox can read those keys."
        : "images and media stored in this browser. Do not edit it by hand;",
      kind === "keys" ? "" : "BUD-E reassembles the parts when restoring.",
    ].filter(Boolean).join("\n");

    return buildSnapshotMessage(
      {
        from,
        to,
        subject: buildSubject(
          createdIso,
          safeLabel,
          id,
          part,
          chunks.length,
          kind,
        ),
        subjectPrefix: markerFor(kind),
        date: created,
        messageId: `${id}.${part}@bud-e`,
        extra: {
          [headerName(H.version)]: String(SNAPSHOT_VERSION),
          [headerName(H.id)]: id,
          [headerName(H.created)]: createdIso,
          [headerName(H.label)]: safeLabel,
          [headerName(H.device)]: safeDevice,
          [headerName(H.part)]: String(part),
          [headerName(H.parts)]: String(chunks.length),
          [headerName(H.chunkBytes)]: String(chunk.length),
          [headerName(H.totalBytes)]: String(packed.length),
          [headerName(H.rawBytes)]: String(snapshotJson.length),
        },
      },
      humanText,
      `bude-${kind}-${id}-${part}of${chunks.length}.json.gz`,
      chunk,
    ).bytes;
  });

  if (account.useSmtp) {
    const client = await SmtpClient.connect(smtpConfig(account));
    try {
      await client.login();
      for (const msg of messages) await client.send(from, [to], msg);
    } finally {
      await client.quit();
    }
  } else {
    await withImap(account, async (client) => {
      await client.ensureFolder(account.folder);
      await client.select(account.folder);
      for (const msg of messages) await client.append(account.folder, msg);
    });
  }

  return {
    ok: true,
    id,
    created: createdIso,
    parts: chunks.length,
    compressedBytes: packed.length,
    rawBytes: snapshotJson.length,
    transport: account.useSmtp ? "smtp" : "imap-append",
    kind,
  };
}

async function actionDownload(
  account: Account,
  uids: number[],
): Promise<Uint8Array> {
  if (uids.length === 0) throw new BadRequest("no message ids given");
  const chunks = await withImap(account, async (client) => {
    await client.select(account.folder);
    const out: Uint8Array[] = [];
    for (const uid of uids) {
      const raw = await client.fetchMessage(uid);
      out.push(extractAttachment(raw));
    }
    return out;
  });
  return await gunzip(concatChunks(chunks));
}

async function actionDelete(account: Account, uids: number[]) {
  if (uids.length === 0) throw new BadRequest("no message ids given");
  await withImap(account, async (client) => {
    await client.select(account.folder);
    await client.deleteUids(uids);
  });
  return { ok: true, deleted: uids.length };
}

// ----------------------------------------------------------------- handler

export const handler: Handlers = {
  async POST(req) {
    try {
      const contentType = req.headers.get("content-type") ?? "";

      // Uploads arrive as multipart so the snapshot does not have to be
      // escaped into a JSON string first.
      if (contentType.includes("multipart/form-data")) {
        const form = await req.formData();
        const meta = JSON.parse(String(form.get("meta") ?? "{}"));
        const account = readAccount(meta.account);
        const file = form.get("snapshot");
        if (!(file instanceof File)) {
          throw new BadRequest("no snapshot file in the request");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        return json(
          await actionUpload(
            account,
            bytes,
            meta.label ?? "",
            meta.device ?? "",
            readKind(meta.kind),
          ),
        );
      }

      const body = await req.json();
      const action = String(body.action ?? "");
      const account = readAccount(body.account);
      const uids = normaliseUids(body.uids);
      const kind = readKind(body.kind);

      switch (action) {
        case "test":
          return json(await actionTest(account));
        case "list":
          return json(await actionList(account, kind));
        case "delete":
          return json(await actionDelete(account, uids));
        case "download": {
          const data = await actionDownload(account, uids);
          return new Response(data, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          });
        }
        default:
          throw new BadRequest(`unknown action "${action}"`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof BadRequest ? 400 : 502;
      console.error("[mailsync]", message);
      return json({ ok: false, error: message }, status);
    }
  },
};

// ----------------------------------------------------------------- helpers

// deno-lint-ignore no-explicit-any
function normaliseUids(raw: any): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// deno-lint-ignore no-explicit-any
function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** "x-bude-id" -> "X-BudE-Id" for the outgoing header line. */
function headerName(lower: string): string {
  return lower
    .split("-")
    .map((p) => (p === "bude" ? "BudE" : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("-");
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
