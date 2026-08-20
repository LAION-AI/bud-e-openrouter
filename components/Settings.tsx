// components/Settings.tsx
import { useState } from "preact/hooks";
import { settingsContent } from "../internalization/content.ts";
import {
  guessDeviceName,
  isMailSyncConfigured,
  type MailAccount,
  mailsyncTest,
} from "../utils/mailsyncClient.ts";
import {
  applyPreset,
  findPreset,
  normaliseDomain,
  PROVIDER_PRESETS,
} from "../utils/mailProviders.ts";
import {
  DEFAULT_MAIL_LIMITS,
  isMailAllowed,
  loadMailLimits,
  type MailLimits,
  saveMailLimits,
  setMailAllowed,
} from "../utils/mailAssistant.ts";

/** The three transport modes we expose, mapped onto the two boolean flags. */
type Security = "tls" | "starttls" | "none";

function securityOf(tls: boolean, starttls: boolean): Security {
  if (tls) return "tls";
  if (starttls) return "starttls";
  return "none";
}

function applySecurity(
  mode: Security,
  ports: { tls: number; starttls: number; plain: number },
) {
  if (mode === "tls") return { tls: true, starttls: false, port: ports.tls };
  if (mode === "starttls") {
    return { tls: false, starttls: true, port: ports.starttls };
  }
  return { tls: false, starttls: false, port: ports.plain };
}

export default function Settings({
  settings,
  mailAccount,
  onSave,
  onSaveMailAccount,
  onOpenMailSync,
  onClose,
  lang = "en",
}: {
  settings: {
    universalApiKey: string;
    apiUrl: string;
    apiKey: string;
    apiModel: string;
    ttsUrl: string;
    ttsKey: string;
    ttsModel: string;
    sttUrl: string;
    sttKey: string;
    sttModel: string;
    systemPrompt: string;
    vlmUrl: string;
    vlmKey: string;
    vlmModel: string;
    vlmCorrectionModel: string;
  };
  mailAccount: MailAccount;
  onSave: (newSettings: typeof settings) => void;
  onSaveMailAccount: (account: MailAccount) => void;
  onOpenMailSync: (account: MailAccount) => void;
  onClose: () => void;
  lang?: string;
}) {
  // --- Default system prompt resolution (pre-fill the textbox) ---
  const DEFAULT_SYSTEM_PROMPT =
    (settingsContent?.[lang]?.systemPromptDefault as string | undefined) ??
    (settingsContent?.en?.systemPromptDefault as string | undefined) ??
    "";

  // Initialize state; if nothing saved yet, show the default in the box.
  const [newSettings, setNewSettings] = useState({
    ...settings,
    systemPrompt:
      (settings?.systemPrompt && settings.systemPrompt.trim().length > 0
        ? settings.systemPrompt
        : DEFAULT_SYSTEM_PROMPT),
  });

  const [showAdvanced, setShowAdvanced] = useState(false);

  // --- Mailbox sync ---
  const [mail, setMail] = useState<MailAccount>({
    ...mailAccount,
    deviceName: mailAccount.deviceName || guessDeviceName(),
  });
  const [showMailSync, setShowMailSync] = useState(false);
  const [showMailInfo, setShowMailInfo] = useState(false);
  const [providerKey, setProviderKey] = useState("iserv");
  const [providerDomain, setProviderDomain] = useState("");
  const [providerNote, setProviderNote] = useState("");

  /** Fills the server fields from the chosen provider. */
  const applyProvider = () => {
    const preset = findPreset(providerKey);
    if (!preset) return;
    const values = applyPreset(preset, providerDomain);
    if (!values) {
      setProviderNote(settingsContent[lang].providerDomainMissing as string);
      return;
    }
    updateMail({
      ...values,
      // A preset that brings an outgoing server should make it usable right
      // away, otherwise the fields sit there greyed out and look broken.
      useSmtp: mail.useSmtp,
    });
    setProviderNote(settingsContent[lang].providerApplied as string);
  };

  // --- Mailbox skill: letting the assistant read and write mail ---
  const [mailSkill, setMailSkill] = useState(() => isMailAllowed());
  const [mailLimits, setMailLimits] = useState<MailLimits>(() =>
    loadMailLimits()
  );
  const updateMailLimits = (patch: Partial<MailLimits>) => {
    const next = { ...mailLimits, ...patch };
    setMailLimits(next);
    saveMailLimits(next);
  };
  const [mailTest, setMailTest] = useState<
    { state: "idle" | "busy" | "ok" | "error"; message: string }
  >({ state: "idle", message: "" });

  const updateMail = (patch: Partial<MailAccount>) =>
    setMail((prev) => ({ ...prev, ...patch }));

  const testMailConnection = async () => {
    setMailTest({ state: "busy", message: "" });
    try {
      const result = await mailsyncTest(mail);
      setMailTest({
        state: "ok",
        message: `${settingsContent[lang].connectionOk} (${
          result.snapshotMails ?? 0
        })`,
      });
    } catch (e) {
      setMailTest({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const providerConfigs = {
    googleai: {
      keyCharacteristics: { startsWith: "AI" },
      config: {
        api: {
          url:
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          model: "gemini-1.5-flash",
        },
        vlm: {
          url:
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          model: "gemini-1.5-flash",
        },
      },
    },
    hyprlab: {
      keyCharacteristics: { startsWith: "hypr-lab" },
      config: {
        api: {
          url: "https://api.hyprlab.io/v1/chat/completions",
          model: "gemini-1.5-pro",
        },
        vlm: {
          url: "https://api.hyprlab.io/v1/chat/completions",
          model: "gemini-1.5-pro",
        },
      },
    },
    groq: {
      keyCharacteristics: { startsWith: "gsk_" },
      config: {
        api: {
          url: "https://api.groq.com/openai/v1/chat/completions",
          model: "llama-3.3-70b-versatile",
        },
        vlm: {
          url: "https://api.groq.com/openai/v1/chat/completions",
          model: "llama-3.2-90b-vision-preview",
        },
        stt: {
          url: "https://api.groq.com/openai/v1/audio/transcriptions",
          model: "whisper-large-v3-turbo",
        },
      },
    },
    sambanova: {
      keyCharacteristics: { length: 36 },
      config: {
        api: {
          url: "https://api.sambanova.ai/v1/chat/completions",
          model: "Meta-Llama-3.3-70B-Instruct",
        },
        vlm: {
          url: "https://api.sambanova.ai/v1/chat/completions",
          model: "Meta-Llama-3.2-90B-Vision-Instruct",
        },
      },
    },
    fish: {
      keyCharacteristics: { length: 32 },
      config: {
        tts: {
          url: "https://api.fish.audio/v1/tts",
          model:
            lang === "de"
              ? "61561f50f41046e0b267aa4cb30e4957"
              : "6f45f4694ff54d6980337a68902e20d7",
        },
      },
    },
    deepgram: {
      keyCharacteristics: { length: 40 },
      config: {
        stt: {
          url: `https://api.deepgram.com/v1/listen?language=en&model=nova-2`,
          model: "nova-2",
        },
        tts: {
          url: `https://api.deepgram.com/v1/speak?model=aura-helios-en`,
          model: "aura-helios-en",
        },
      },
    },
  } as const;

  function updateSettings(key: string, value: string) {
    const updatedSettings: typeof newSettings = { ...newSettings };

    if (key !== "universalApiKey") {
      if (key.endsWith("Key") && value !== "") {
        const serviceType = key.slice(0, -3); // 'api' | 'tts' | 'stt' | 'vlm'
        const urlKey = `${serviceType}Url` as keyof typeof settings;
        const modelKey = `${serviceType}Model` as keyof typeof settings;

        // Find matching provider based on key characteristics
        const provider = Object.values(providerConfigs).find((p) => {
          const kc = p.keyCharacteristics as
            | { startsWith: string }
            | { length: number };
          return (
            ("startsWith" in kc && value.startsWith(kc.startsWith)) ||
            ("length" in kc && kc.length === value.length)
          );
        });

        const svc =
          provider?.config[serviceType as keyof typeof provider.config] as
            | { url: string; model: string }
            | undefined;

        if (svc) {
          // Auto-fill URL and model based on provider
          (updatedSettings as any)[urlKey] = svc.url;
          (updatedSettings as any)[modelKey] = svc.model;
        }
      }
    }

    (updatedSettings as any)[key as keyof typeof settings] = value;
    setNewSettings(updatedSettings);
  }

  const t = (key: string) => settingsContent[lang][key] as string;

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {showMailInfo && (
        <div
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          onClick={() => setShowMailInfo(false)}
        >
          <div
            class="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex justify-between items-center px-5 py-3 border-b bg-blue-50">
              <h3 class="font-bold text-blue-900">{t("mailInfoTitle")}</h3>
              <button
                onClick={() => setShowMailInfo(false)}
                class="text-blue-700 hover:text-blue-900 text-sm"
              >
                {t("close")}
              </button>
            </div>
            <div class="px-5 py-4 space-y-3 text-sm text-slate-700">
              <p>{t("mailInfoBody")}</p>
              <div class="flex gap-2.5">
                <span class="text-lg leading-none shrink-0">📥</span>
                <p>{t("mailInfoImap")}</p>
              </div>
              <div class="flex gap-2.5">
                <span class="text-lg leading-none shrink-0">📤</span>
                <p>{t("mailInfoSmtp")}</p>
              </div>

              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="bg-slate-100">
                    <th class="border px-2 py-1 text-left"></th>
                    <th class="border px-2 py-1">TLS</th>
                    <th class="border px-2 py-1">STARTTLS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="border px-2 py-1 font-medium">IMAP</td>
                    <td class="border px-2 py-1 text-center">993</td>
                    <td class="border px-2 py-1 text-center">143</td>
                  </tr>
                  <tr>
                    <td class="border px-2 py-1 font-medium">SMTP</td>
                    <td class="border px-2 py-1 text-center">465</td>
                    <td class="border px-2 py-1 text-center">587</td>
                  </tr>
                </tbody>
              </table>
              <p class="text-xs text-slate-600">{t("mailInfoPorts")}</p>

              <div class="flex gap-2.5 bg-amber-50 border border-amber-200 rounded p-2.5">
                <span class="text-lg leading-none shrink-0">🔑</span>
                <p class="text-xs text-amber-900">{t("mailInfoPassword")}</p>
              </div>
              <p class="text-xs text-slate-500">{t("mailInfoWhere")}</p>
            </div>
          </div>
        </div>
      )}
      <div class="bg-white p-6 rounded-lg shadow-xl max-w-md w-full m-4 overflow-y-scroll max-h-[90dvh]">
        <div class="flex justify-between items-center mb-4">
          {/* Note: the gear emoji caused mojibake previously; keep this plain text. */}
          <h2 class="text-xl font-bold">
            {settingsContent[lang].title}
          </h2>
          <button
            onClick={onClose}
            class="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            {settingsContent[lang].back}
          </button>
        </div>

        {/* Basic Settings */}
        <div class="mb-4">
          {/* Remove emoji to avoid ?? rendering */}
          <label class="block text-sm font-medium text-gray-700 mb-2">
            {settingsContent[lang].universalApiKeyLabel}
          </label>
          <input
            type="password"
            value={newSettings.universalApiKey}
            onChange={(e) =>
              updateSettings(
                "universalApiKey",
                (e.target as HTMLInputElement).value,
              )}
            class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
            placeholder={settingsContent[lang].universalApiKeyPlaceholder}
          />
        </div>

        {/* System Prompt (persists locally) */}
        <div class="mb-4">
          {/* Plain label (no emoji), so no "??" */}
          <label class="block text-sm font-medium text-gray-700 mb-2">
            {settingsContent[lang].systemPromptLabel}
          </label>
          <textarea
            value={newSettings.systemPrompt}
            onChange={(e) =>
              updateSettings(
                "systemPrompt",
                (e.target as HTMLTextAreaElement).value,
              )
            }
            class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 min-h-[8rem]"
            placeholder="Optional: override the default system prompt for all chats in this browser"
          />
        </div>

        {/* Mailbox sync (own section, collapsed by default) */}
        <div class="mb-4 border rounded">
          <button
            onClick={() => setShowMailSync(!showMailSync)}
            class="w-full text-left px-3 py-2 font-medium flex justify-between items-center"
          >
            <span>{settingsContent[lang].mailSyncTitle}</span>
            <span class="text-gray-400">{showMailSync ? "-" : "+"}</span>
          </button>

          {showMailSync && (
            <div class="px-3 pb-3 space-y-3">
              <div class="flex items-start gap-2">
                <p class="text-xs text-gray-500 flex-1">
                  {settingsContent[lang].mailSyncHint}
                </p>
                <button
                  onClick={() => setShowMailInfo(true)}
                  title={settingsContent[lang].mailInfoTitle as string}
                  class="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700
                         hover:bg-blue-200 text-sm font-bold leading-none"
                >
                  i
                </button>
              </div>

              {/* Provider presets: nobody should have to look up port numbers. */}
              <div class="p-2.5 bg-slate-50 border rounded space-y-2">
                <label class="block text-sm font-medium text-gray-700">
                  {settingsContent[lang].providerLabel}
                </label>
                <div class="flex flex-wrap gap-2">
                  <select
                    value={providerKey}
                    onChange={(e) => {
                      setProviderKey((e.target as HTMLSelectElement).value);
                      setProviderNote("");
                    }}
                    class="flex-1 min-w-[10rem] p-2 border rounded bg-white text-sm"
                  >
                    {PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={applyProvider}
                    class="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    {settingsContent[lang].providerApply}
                  </button>
                </div>

                {findPreset(providerKey)?.needsDomain && (
                  <div>
                    <label class="block text-xs text-gray-600 mb-1">
                      {findPreset(providerKey)!.domainLabel?.[
                        lang === "de" ? "de" : "en"
                      ]}
                    </label>
                    <input
                      type="text"
                      value={providerDomain}
                      onInput={(e) => {
                        setProviderDomain((e.target as HTMLInputElement).value);
                        setProviderNote("");
                      }}
                      onBlur={(e) =>
                        setProviderDomain(
                          normaliseDomain((e.target as HTMLInputElement).value),
                        )}
                      placeholder={findPreset(providerKey)!.domainPlaceholder}
                      class="w-full p-2 border rounded text-sm"
                    />
                  </div>
                )}

                {findPreset(providerKey)?.note && (
                  <p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    {findPreset(providerKey)!.note![lang === "de" ? "de" : "en"]}
                  </p>
                )}
                {providerNote && (
                  <p class="text-xs text-green-700">{providerNote}</p>
                )}
                <p class="text-xs text-gray-500">
                  {settingsContent[lang].providerHint}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {settingsContent[lang].imapHostLabel}
                </label>
                <input
                  type="text"
                  value={mail.imapHost}
                  onInput={(e) =>
                    updateMail({
                      imapHost: (e.target as HTMLInputElement).value.trim(),
                    })}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].imapHostPlaceholder}
                />
              </div>

              <div class="flex gap-2">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {settingsContent[lang].imapSecurityLabel}
                  </label>
                  <select
                    value={securityOf(mail.imapTls, mail.imapStartTls)}
                    onChange={(e) => {
                      const mode = (e.target as HTMLSelectElement)
                        .value as Security;
                      const next = applySecurity(mode, {
                        tls: 993,
                        starttls: 143,
                        plain: 143,
                      });
                      updateMail({
                        imapTls: next.tls,
                        imapStartTls: next.starttls,
                        imapPort: next.port,
                      });
                    }}
                    class="w-full p-2 border rounded bg-white"
                  >
                    <option value="tls">
                      {settingsContent[lang].imapSecurityTls}
                    </option>
                    <option value="starttls">
                      {settingsContent[lang].imapSecurityStartTls}
                    </option>
                    <option value="none">
                      {settingsContent[lang].imapSecurityNone}
                    </option>
                  </select>
                </div>
                <div class="w-24">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {settingsContent[lang].imapPortLabel}
                  </label>
                  <input
                    type="number"
                    value={mail.imapPort}
                    onInput={(e) =>
                      updateMail({
                        imapPort: Number((e.target as HTMLInputElement).value) ||
                          0,
                      })}
                    class="w-full p-2 border rounded"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {settingsContent[lang].imapUserLabel}
                </label>
                <input
                  type="text"
                  value={mail.imapUser}
                  onInput={(e) =>
                    updateMail({
                      imapUser: (e.target as HTMLInputElement).value.trim(),
                    })}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].imapUserPlaceholder}
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {settingsContent[lang].imapPassLabel}
                </label>
                <input
                  type="password"
                  value={mail.imapPass}
                  onInput={(e) =>
                    updateMail({ imapPass: (e.target as HTMLInputElement).value })}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
                  placeholder={settingsContent[lang].imapPassPlaceholder}
                />
              </div>

              <div class="flex gap-2">
                <div class="flex-1">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {settingsContent[lang].folderLabel}
                  </label>
                  <input
                    type="text"
                    value={mail.folder}
                    onInput={(e) =>
                      updateMail({
                        folder: (e.target as HTMLInputElement).value.trim(),
                      })}
                    class="w-full p-2 border rounded"
                    placeholder={settingsContent[lang].folderPlaceholder}
                  />
                </div>
                <div class="flex-1">
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {settingsContent[lang].deviceNameLabel}
                  </label>
                  <input
                    type="text"
                    value={mail.deviceName}
                    onInput={(e) =>
                      updateMail({
                        deviceName: (e.target as HTMLInputElement).value,
                      })}
                    class="w-full p-2 border rounded"
                    placeholder={settingsContent[lang].deviceNamePlaceholder}
                  />
                </div>
              </div>

              <label class="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={mail.autoUpload}
                  onChange={(e) =>
                    updateMail({
                      autoUpload: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span>{settingsContent[lang].autoUploadLabel}</span>
              </label>
              <label class="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={mail.autoDownload}
                  onChange={(e) =>
                    updateMail({
                      autoDownload: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span>{settingsContent[lang].autoDownloadLabel}</span>
              </label>

              {/* Optional SMTP path */}
              <label class="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={mail.useSmtp}
                  onChange={(e) =>
                    updateMail({
                      useSmtp: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span>{settingsContent[lang].useSmtpLabel}</span>
              </label>

              {mail.useSmtp && (
                <div class="space-y-3 pl-6 border-l-2 border-slate-200">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      {settingsContent[lang].smtpHostLabel}
                    </label>
                    <input
                      type="text"
                      value={mail.smtpHost}
                      onInput={(e) =>
                        updateMail({
                          smtpHost: (e.target as HTMLInputElement).value.trim(),
                        })}
                      class="w-full p-2 border rounded"
                    />
                  </div>
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <label class="block text-sm font-medium text-gray-700 mb-1">
                        {settingsContent[lang].smtpSecurityLabel}
                      </label>
                      <select
                        value={securityOf(mail.smtpTls, mail.smtpStartTls)}
                        onChange={(e) => {
                          const mode = (e.target as HTMLSelectElement)
                            .value as Security;
                          const next = applySecurity(mode, {
                            tls: 465,
                            starttls: 587,
                            plain: 25,
                          });
                          updateMail({
                            smtpTls: next.tls,
                            smtpStartTls: next.starttls,
                            smtpPort: next.port,
                          });
                        }}
                        class="w-full p-2 border rounded bg-white"
                      >
                        <option value="tls">TLS (465)</option>
                        <option value="starttls">STARTTLS (587)</option>
                        <option value="none">
                          {settingsContent[lang].imapSecurityNone}
                        </option>
                      </select>
                    </div>
                    <div class="w-24">
                      <label class="block text-sm font-medium text-gray-700 mb-1">
                        {settingsContent[lang].smtpPortLabel}
                      </label>
                      <input
                        type="number"
                        value={mail.smtpPort}
                        onInput={(e) =>
                          updateMail({
                            smtpPort:
                              Number((e.target as HTMLInputElement).value) || 0,
                          })}
                        class="w-full p-2 border rounded"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    value={mail.smtpUser}
                    onInput={(e) =>
                      updateMail({
                        smtpUser: (e.target as HTMLInputElement).value.trim(),
                      })}
                    class="w-full p-2 border rounded"
                    placeholder={settingsContent[lang].smtpUserLabel}
                  />
                  <input
                    type="password"
                    value={mail.smtpPass}
                    onInput={(e) =>
                      updateMail({
                        smtpPass: (e.target as HTMLInputElement).value,
                      })}
                    class="w-full p-2 border rounded bg-yellow-50"
                    placeholder={settingsContent[lang].smtpPassLabel}
                  />
                  <input
                    type="text"
                    value={mail.fromAddress}
                    onInput={(e) =>
                      updateMail({
                        fromAddress: (e.target as HTMLInputElement).value.trim(),
                      })}
                    class="w-full p-2 border rounded"
                    placeholder={settingsContent[lang].fromAddressLabel}
                  />
                  <input
                    type="text"
                    value={mail.toAddress}
                    onInput={(e) =>
                      updateMail({
                        toAddress: (e.target as HTMLInputElement).value.trim(),
                      })}
                    class="w-full p-2 border rounded"
                    placeholder={settingsContent[lang].toAddressLabel}
                  />
                </div>
              )}

              <div class="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={testMailConnection}
                  disabled={!isMailSyncConfigured(mail) ||
                    mailTest.state === "busy"}
                  class="px-3 py-2 bg-slate-200 rounded hover:bg-slate-300 disabled:opacity-50 text-sm"
                >
                  {mailTest.state === "busy"
                    ? settingsContent[lang].testing
                    : settingsContent[lang].testConnection}
                </button>
                <button
                  onClick={() => {
                    onSaveMailAccount(mail);
                    onOpenMailSync(mail);
                  }}
                  disabled={!isMailSyncConfigured(mail)}
                  class="px-3 py-2 bg-green-200 rounded hover:bg-green-300 disabled:opacity-50 text-sm font-medium"
                >
                  {settingsContent[lang].openMailSync}
                </button>
              </div>

              {!isMailSyncConfigured(mail) && (
                <p class="text-xs text-gray-500">
                  {settingsContent[lang].mailSyncNotConfigured}
                </p>
              )}
              {mailTest.state === "ok" && (
                <p class="text-xs text-green-700">{mailTest.message}</p>
              )}
              {mailTest.state === "error" && (
                <p class="text-xs text-red-700 break-words">
                  {mailTest.message}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Mailbox skill: the assistant reading and writing mail. Its own
            section, because granting it is a much bigger decision than
            setting up the sync. */}
        <div class="mb-4 border rounded">
          <div class="px-3 py-2">
            <label class="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="mt-1 w-4 h-4 accent-blue-600"
                checked={mailSkill}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  setMailSkill(on);
                  setMailAllowed(on);
                }}
              />
              <span>
                <span class="font-medium flex items-center gap-1.5">
                  <span class="text-lg leading-none">📬</span>
                  {settingsContent[lang].mailSkillTitle}
                </span>
                <span class="block text-xs text-gray-500 mt-0.5">
                  {settingsContent[lang].mailSkillHint}
                </span>
              </span>
            </label>

            {mailSkill && (
              <div class="mt-3 pl-6 space-y-3 border-l-2 border-slate-200">
                {!isMailSyncConfigured(mail) && (
                  <p class="text-xs text-amber-700">
                    {settingsContent[lang].mailSyncNotConfigured}
                  </p>
                )}

                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">
                    {settingsContent[lang].mailFolders}
                  </label>
                  <input
                    type="text"
                    value={mailLimits.folders.join(", ")}
                    onInput={(e) =>
                      updateMailLimits({
                        folders: (e.target as HTMLInputElement).value
                          .split(",")
                          .map((f) => f.trim())
                          .filter(Boolean),
                      })}
                    class="w-full p-2 border rounded text-sm"
                    placeholder="INBOX, Sent, Drafts"
                  />
                </div>

                <div class="flex flex-wrap gap-3">
                  <label class="text-xs text-gray-700">
                    <span class="block mb-0.5">
                      {settingsContent[lang].mailListLimit}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={mailLimits.listLimit}
                      onInput={(e) =>
                        updateMailLimits({
                          listLimit: clampNumber(
                            (e.target as HTMLInputElement).value, 1, 200,
                            DEFAULT_MAIL_LIMITS.listLimit,
                          ),
                        })}
                      class="w-24 p-1.5 border rounded"
                    />
                  </label>
                  <label class="text-xs text-gray-700">
                    <span class="block mb-0.5">
                      {settingsContent[lang].mailBodyChars}
                    </span>
                    <input
                      type="number"
                      min={200}
                      max={100000}
                      value={mailLimits.bodyChars}
                      onInput={(e) =>
                        updateMailLimits({
                          bodyChars: clampNumber(
                            (e.target as HTMLInputElement).value, 200, 100000,
                            DEFAULT_MAIL_LIMITS.bodyChars,
                          ),
                        })}
                      class="w-28 p-1.5 border rounded"
                    />
                  </label>
                  <label class="text-xs text-gray-700">
                    <span class="block mb-0.5">
                      {settingsContent[lang].mailAttachmentMb}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={mailLimits.attachmentMb}
                      onInput={(e) =>
                        updateMailLimits({
                          attachmentMb: clampNumber(
                            (e.target as HTMLInputElement).value, 1, 100,
                            DEFAULT_MAIL_LIMITS.attachmentMb,
                          ),
                        })}
                      class="w-24 p-1.5 border rounded"
                    />
                  </label>
                </div>

                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="w-4 h-4 accent-blue-600"
                    checked={mailLimits.allowDrafts}
                    onChange={(e) =>
                      updateMailLimits({
                        allowDrafts: (e.target as HTMLInputElement).checked,
                      })}
                  />
                  {settingsContent[lang].mailAllowDrafts}
                </label>

                <div>
                  <label class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="w-4 h-4 accent-red-600"
                      checked={mailLimits.allowSend}
                      onChange={(e) =>
                        updateMailLimits({
                          allowSend: (e.target as HTMLInputElement).checked,
                        })}
                    />
                    {settingsContent[lang].mailAllowSend}
                  </label>
                  <p class="text-xs text-gray-500 ml-6">
                    {settingsContent[lang].mailAllowSendHint}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Settings Toggle Button */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          class="mb-4 text-blue-500 hover:text-blue-600"
        >
          {showAdvanced
            ? settingsContent[lang].lessSettings
            : settingsContent[lang].advancedSettings}
        </button>

        {/* Advanced Settings */}
        {showAdvanced && (
          <>
            {/* Chat API Settings */}
            <div class="mb-4">
              <h3 class="font-medium mb-2">
                {settingsContent[lang].chatApiTitle}
              </h3>
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    {settingsContent[lang].apiKeyLabel}
                  </label>
                  <input
                    type="password"
                    value={newSettings.apiKey}
                    onChange={(e) =>
                      updateSettings(
                        "apiKey",
                        (e.target as HTMLInputElement).value,
                      )}
                    class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
                    placeholder={settingsContent[lang].apiKeyPlaceholder}
                  />
                </div>
                <div class="mb-4">
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    {settingsContent[lang].apiUrlLabel}
                  </label>
                  <input
                    type="text"
                    value={newSettings.apiUrl}
                    onChange={(e) =>
                      updateSettings(
                        "apiUrl",
                        (e.target as HTMLInputElement).value,
                      )}
                    class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                    placeholder={settingsContent[lang].apiUrlPlaceholder}
                  />
                </div>

                <div class="mb-4">
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    {settingsContent[lang].modelLabel}
                  </label>
                  <input
                    type="text"
                    value={newSettings.apiModel}
                    onChange={(e) =>
                      updateSettings(
                        "apiModel",
                        (e.target as HTMLInputElement).value,
                      )}
                    class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                    placeholder={settingsContent[lang].modelPlaceholder}
                  />
                </div>
              </div>
            </div>

            {/* TTS Settings */}
            <div class="mb-4">
              <h3 class="font-medium mb-2">
                {settingsContent[lang].ttsTitle}
              </h3>
              <div class="space-y-4">
                <input
                  type="password"
                  value={newSettings.ttsKey}
                  onChange={(e) =>
                    updateSettings(
                      "ttsKey",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
                  placeholder={settingsContent[lang].ttsKeyPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.ttsUrl}
                  onChange={(e) =>
                    updateSettings(
                      "ttsUrl",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].ttsUrlPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.ttsModel}
                  onChange={(e) =>
                    updateSettings(
                      "ttsModel",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].ttsModelPlaceholder}
                />
              </div>
            </div>

            {/* STT Settings */}
            <div class="mb-4">
              <h3 class="font-medium mb-2">
                {settingsContent[lang].sttTitle}
              </h3>
              <div class="space-y-4">
                <input
                  type="password"
                  value={newSettings.sttKey}
                  onChange={(e) =>
                    updateSettings(
                      "sttKey",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
                  placeholder={settingsContent[lang].sttKeyPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.sttUrl}
                  onChange={(e) =>
                    updateSettings(
                      "sttUrl",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].sttUrlPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.sttModel}
                  onChange={(e) =>
                    updateSettings(
                      "sttModel",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].sttModelPlaceholder}
                />
              </div>
            </div>

            {/* VLM Settings */}
            <div class="mb-4">
              <h3 class="font-medium mb-2">
                {settingsContent[lang].vlmTitle}
              </h3>
              <div class="space-y-4">
                <input
                  type="password"
                  value={newSettings.vlmKey}
                  onChange={(e) =>
                    updateSettings(
                      "vlmKey",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 bg-yellow-50"
                  placeholder={settingsContent[lang].vlmKeyPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.vlmUrl}
                  onChange={(e) =>
                    updateSettings(
                      "vlmUrl",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].vlmUrlPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.vlmModel}
                  onChange={(e) =>
                    updateSettings(
                      "vlmModel",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={settingsContent[lang].vlmModelPlaceholder}
                />
                <input
                  type="text"
                  value={newSettings.vlmCorrectionModel}
                  onChange={(e) =>
                    updateSettings(
                      "vlmCorrectionModel",
                      (e.target as HTMLInputElement).value,
                    )}
                  class="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder={
                    settingsContent[lang].vlmCorrectionModelPlaceholder
                  }
                />
              </div>
            </div>
          </>
        )}

        <div class="flex justify-end space-x-4">
          <button
            onClick={onClose}
            class="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            {settingsContent[lang].cancel}
          </button>
          <button
            onClick={() => {
              onSaveMailAccount(mail);
              onSave(newSettings);
            }}
            class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {settingsContent[lang].save}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reads a number field, keeping it inside sane bounds. */
function clampNumber(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
