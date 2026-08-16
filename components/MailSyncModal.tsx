// components/MailSyncModal.tsx
//
// Browser for the snapshots stored in the user's mailbox: back up the current
// state, restore an older one, delete backups that are no longer needed.

import { useEffect, useState } from "preact/hooks";
import { mailSyncContent } from "../internalization/content.ts";
import {
  applySnapshot,
  collectSnapshot,
  formatBytes,
  formatCreated,
  type MailAccount,
  mailsyncDelete,
  mailsyncDownload,
  mailsyncList,
  mailsyncUpload,
  setLastSync,
  type SnapshotSummary,
} from "../utils/mailsyncClient.ts";

type Busy = "" | "list" | "upload" | "download" | "delete";

export default function MailSyncModal({
  account,
  lang = "en",
  onClose,
  onRestored,
}: {
  account: MailAccount;
  lang?: string;
  onClose: () => void;
  onRestored: (firstSuffix: string) => void;
}) {
  const t = (key: string) =>
    (mailSyncContent[lang]?.[key] ?? mailSyncContent.en[key] ?? key) as string;

  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [label, setLabel] = useState("");
  const [replaceAll, setReplaceAll] = useState(false);
  const [restorePrefs, setRestorePrefs] = useState(true);

  const refresh = async () => {
    setBusy("list");
    setError("");
    try {
      setSnapshots(await mailsyncList(account));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const backupNow = async () => {
    setBusy("upload");
    setError("");
    setNotice("");
    try {
      const json = await collectSnapshot(account.deviceName);
      const result = await mailsyncUpload(
        account,
        json,
        label.trim() || defaultLabel(),
      );
      setLastSync(result.created);
      setNotice(
        `${t("uploadedMsg")} (${formatBytes(result.compressedBytes)}, ${
          result.parts
        } ${result.parts === 1 ? t("part") : t("parts")})`,
      );
      setLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const restore = async (snap: SnapshotSummary) => {
    if (!snap.complete) {
      setError(t("incompleteError"));
      return;
    }
    if (!confirm(replaceAll ? t("confirmReplace") : t("confirmMerge"))) return;

    setBusy("download");
    setError("");
    setNotice("");
    try {
      const json = await mailsyncDownload(account, snap.uids);
      const result = await applySnapshot(json, { replaceAll, restorePrefs });
      setLastSync(snap.created);
      setNotice(`${t("restoredMsg")}: ${result.chats}`);
      onRestored(result.firstSuffix);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const deleteSelected = async () => {
    const chosen = snapshots.filter((s) => selected.has(s.id));
    if (chosen.length === 0) return;
    if (!confirm(t("confirmDelete").replace("{n}", String(chosen.length)))) {
      return;
    }
    setBusy("delete");
    setError("");
    setNotice("");
    try {
      const uids = chosen.flatMap((s) => s.uids);
      await mailsyncDelete(account, uids);
      setNotice(`${t("deletedMsg")}: ${chosen.length}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const working = busy !== "";

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90dvh] flex flex-col">
        <div class="flex justify-between items-center p-5 border-b">
          <div>
            <h2 class="text-xl font-bold">{t("title")}</h2>
            <p class="text-sm text-gray-500">
              {account.imapUser} - {account.folder}
            </p>
          </div>
          <button
            onClick={onClose}
            class="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            {t("close")}
          </button>
        </div>

        {/* Backup row */}
        <div class="p-5 border-b bg-gray-50">
          <div class="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={label}
              disabled={working}
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
              placeholder={t("labelPlaceholder")}
              class="flex-1 min-w-[12rem] p-2 border rounded focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={backupNow}
              disabled={working}
              class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {busy === "upload" ? t("uploading") : t("backupNow")}
            </button>
            <button
              onClick={refresh}
              disabled={working}
              class="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300 disabled:opacity-50"
            >
              {busy === "list" ? t("loading") : t("refresh")}
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-2">{t("backupHint")}</p>
        </div>

        {/* Messages */}
        {error && (
          <div class="mx-5 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm break-words">
            {error}
          </div>
        )}
        {notice && !error && (
          <div class="mx-5 mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded text-sm">
            {notice}
          </div>
        )}

        {/* Snapshot list */}
        <div class="flex-1 overflow-y-auto p-5">
          {snapshots.length === 0 && !working && (
            <p class="text-gray-500 text-sm">{t("noSnapshots")}</p>
          )}

          <ul class="space-y-2">
            {snapshots.map((snap) => (
              <li
                key={snap.id}
                class={`border rounded p-3 flex flex-wrap gap-3 items-center ${
                  snap.complete ? "" : "border-amber-300 bg-amber-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(snap.id)}
                  disabled={working}
                  onChange={() => toggle(snap.id)}
                  class="w-4 h-4"
                />
                <div class="flex-1 min-w-[14rem]">
                  <div class="font-medium">
                    {formatCreated(snap.created)} - {snap.label}
                  </div>
                  <div class="text-xs text-gray-500">
                    {snap.device ? snap.device + " - " : ""}
                    {formatBytes(snap.totalBytes)}
                    {snap.rawBytes
                      ? ` (${formatBytes(snap.rawBytes)} ${t("uncompressed")})`
                      : ""}
                    {snap.parts > 1 ? ` - ${snap.parts} ${t("parts")}` : ""}
                    {snap.complete ? "" : ` - ${t("incomplete")}`}
                  </div>
                </div>
                <button
                  onClick={() => restore(snap)}
                  disabled={working || !snap.complete}
                  class="px-3 py-1.5 bg-green-200 rounded hover:bg-green-300 disabled:opacity-50 text-sm font-medium"
                >
                  {busy === "download" ? t("restoring") : t("restore")}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div class="p-5 border-t space-y-3">
          <div class="flex flex-wrap gap-4 text-sm">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={replaceAll}
                onChange={(e) =>
                  setReplaceAll((e.target as HTMLInputElement).checked)}
              />
              {t("replaceAll")}
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restorePrefs}
                onChange={(e) =>
                  setRestorePrefs((e.target as HTMLInputElement).checked)}
              />
              {t("restorePrefs")}
            </label>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-gray-500">
              {selected.size > 0
                ? `${selected.size} ${t("selected")}`
                : t("selectHint")}
            </span>
            <button
              onClick={deleteSelected}
              disabled={working || selected.size === 0}
              class="px-4 py-2 bg-red-200 font-bold rounded hover:bg-red-300 disabled:opacity-50"
            >
              {busy === "delete" ? t("deleting") : t("deleteSelected")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Backup ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
