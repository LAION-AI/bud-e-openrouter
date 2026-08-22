/**
 * @file mailProviders.ts
 * @description Ready-made mailbox settings, so nobody has to look up ports.
 *
 *              The values are the ones the providers document for external
 *              mail programs. They are a starting point, not gospel - a
 *              provider can change them, and the settings dialog says so.
 *
 *              IServ is the interesting case: every school runs its own
 *              server, so there is no fixed hostname. The user types the
 *              address of their school's IServ and the rest is derived from
 *              it, which is exactly how IServ documents it.
 */

export interface ProviderPreset {
  key: string;
  label: string;
  /** Filled in from the school/company address the user types. */
  needsDomain?: boolean;
  domainLabel?: { de: string; en: string };
  domainPlaceholder?: string;
  /** Example login name, shown greyed out in the user field. */
  userPlaceholder?: string;
  /** "%d" is replaced by the domain the user typed. */
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapStartTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpStartTls: boolean;
  /** Shown under the picker; the one thing people trip over. */
  note?: { de: string; en: string };
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "schuldock",
    label: "Schuldock (Schule)",
    imapHost: "imap.mail.schuldock.de",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "smtp.mail.schuldock.de",
    smtpPort: 465,
    smtpTls: true,
    smtpStartTls: false,
    userPlaceholder: "vorname.nachname",
    note: {
      de:
        "Server und Ports stehen schon richtig - du brauchst nur deinen Anmeldenamen in der Form vorname.nachname und dein IServ-Kennwort. Beides ist dasselbe, mit dem du dich auch sonst anmeldest.",
      en:
        "Servers and ports are already filled in - you only need your login name in the form firstname.lastname and your IServ password. Both are the same ones you sign in with elsewhere.",
    },
  },
  {
    key: "iserv",
    label: "IServ (Schule)",
    needsDomain: true,
    domainLabel: {
      de: "Adresse deiner Schule",
      en: "Your school's address",
    },
    domainPlaceholder: "meine-schule.de",
    imapHost: "%d",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "%d",
    smtpPort: 465,
    smtpTls: true,
    smtpStartTls: false,
    note: {
      de:
        "Jede Schule betreibt ihren eigenen IServ - der Mailserver ist dieselbe Adresse, unter der du dich auch im Browser anmeldest. Die genauen Werte zeigt dir IServ selbst unter E-Mail und dann Apps. Als Benutzername nimmst du deinen IServ-Anmeldenamen.",
      en:
        "Every school runs its own IServ - the mail server is the same address you log in to in the browser. IServ shows you the exact values under E-Mail, then Apps. Use your IServ login name as the user name.",
    },
  },
  {
    key: "gmail",
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpTls: true,
    smtpStartTls: false,
    note: {
      de:
        "Gmail lehnt dein normales Passwort ab. Du brauchst ein App-Passwort aus den Google-Kontoeinstellungen, und die Zwei-Faktor-Anmeldung muss dafür aktiv sein.",
      en:
        "Gmail refuses your normal password. You need an app password from your Google account settings, and two-factor sign-in has to be switched on for that.",
    },
  },
  {
    key: "outlook",
    label: "Outlook / Microsoft 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpTls: false,
    smtpStartTls: true,
    note: {
      de:
        "Bei Geschäfts- und Schulkonten ist der IMAP-Zugang oft von der Verwaltung abgeschaltet. Falls die Anmeldung scheitert, liegt es meist daran.",
      en:
        "For work and school accounts, IMAP access is often switched off by the administrator. If signing in fails, that is usually why.",
    },
  },
  {
    key: "gmx",
    label: "GMX",
    imapHost: "imap.gmx.net",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "mail.gmx.net",
    smtpPort: 587,
    smtpTls: false,
    smtpStartTls: true,
    note: {
      de:
        "GMX schaltet den IMAP-Zugang erst frei, wenn du ihn in deinen GMX-Einstellungen erlaubst.",
      en:
        "GMX only opens IMAP access once you allow it in your GMX settings.",
    },
  },
  {
    key: "webde",
    label: "WEB.DE",
    imapHost: "imap.web.de",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "smtp.web.de",
    smtpPort: 587,
    smtpTls: false,
    smtpStartTls: true,
    note: {
      de:
        "Wie bei GMX muss der IMAP-Zugang zuerst in den WEB.DE-Einstellungen erlaubt werden.",
      en: "As with GMX, IMAP access has to be allowed in the WEB.DE settings first.",
    },
  },
  {
    key: "mailbox",
    label: "mailbox.org",
    imapHost: "imap.mailbox.org",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "smtp.mailbox.org",
    smtpPort: 465,
    smtpTls: true,
    smtpStartTls: false,
  },
  {
    key: "posteo",
    label: "Posteo",
    imapHost: "posteo.de",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "posteo.de",
    smtpPort: 465,
    smtpTls: true,
    smtpStartTls: false,
  },
  {
    key: "custom",
    label: "Anderer Anbieter / eigener Server",
    imapHost: "",
    imapPort: 993,
    imapTls: true,
    imapStartTls: false,
    smtpHost: "",
    smtpPort: 587,
    smtpTls: false,
    smtpStartTls: true,
  },
];

/**
 * Turns a preset plus, where needed, the typed domain into concrete settings.
 * Returns null when the preset still needs a domain that has not been given.
 */
export function applyPreset(
  preset: ProviderPreset,
  domain: string,
): {
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapStartTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpStartTls: boolean;
} | null {
  const clean = normaliseDomain(domain);
  if (preset.needsDomain && !clean) return null;

  const fill = (template: string) => template.replaceAll("%d", clean);
  return {
    imapHost: fill(preset.imapHost),
    imapPort: preset.imapPort,
    imapTls: preset.imapTls,
    imapStartTls: preset.imapStartTls,
    smtpHost: fill(preset.smtpHost),
    smtpPort: preset.smtpPort,
    smtpTls: preset.smtpTls,
    smtpStartTls: preset.smtpStartTls,
  };
}

/**
 * People paste all sorts of things here: a full URL, a mail address, a
 * trailing slash. Reduce it to the bare host.
 */
export function normaliseDomain(raw: string): string {
  let value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^[a-z]+:\/\//, ""); // https://
  value = value.split("/")[0]; // path
  if (value.includes("@")) value = value.split("@").pop() ?? ""; // mail address
  value = value.replace(/:\d+$/, ""); // port
  return value.replace(/^\.+|\.+$/g, "");
}

export function findPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.key === key);
}
