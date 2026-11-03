/** Account credits and key spending allowances are independent values.
 * https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits
 * https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
 */
export type OpenRouterBalance = {
  accountAvailable: boolean;
  accountScope: "supplied-management-key" | "room-key";
  accountError?: string;
  requiresManagementKey?: boolean;
  totalCredits?: number;
  totalUsage?: number;
  remainingCredits?: number;
  keyLimit: number | null;
  keyLimitRemaining: number | null;
  keyLimitState: "unknown" | "unlimited" | "limited";
  keyError?: string;
  checkedAt: string;
};

function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function read(endpoint: string, key: string) {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return { status: response.status, data: null };
    const body = await response.json();
    const data = body?.data;
    return {
      status: response.status,
      data: data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null,
    };
  } catch {
    return { status: 0, data: null };
  }
}

export async function readOpenRouterBalance(
  chatKey: string,
  managementKey?: string,
): Promise<OpenRouterBalance> {
  const [key, credits] = await Promise.all([
    read("key", chatKey),
    read("credits", managementKey || chatKey),
  ]);
  const result: OpenRouterBalance = {
    accountAvailable: false,
    accountScope: managementKey ? "supplied-management-key" : "room-key",
    keyLimit: amount(key.data?.limit),
    keyLimitRemaining: amount(key.data?.limit_remaining),
    keyLimitState: key.data?.limit === null
      ? "unlimited"
      : amount(key.data?.limit) !== null
      ? "limited"
      : "unknown",
    checkedAt: new Date().toISOString(),
  };
  if (!key.data) {
    result.keyError = "Das Chat-Key-Limit ist gerade nicht abrufbar.";
  }
  const totalCredits = amount(credits.data?.total_credits);
  const totalUsage = amount(credits.data?.total_usage);
  // A non-management inference key is not authorized for account credits,
  // even if a provider returns a nominal 200/zero response instead of 403.
  const missingPermission = !managementKey &&
    key.data?.is_management_key === false;
  if (
    !missingPermission && totalCredits !== null && totalUsage !== null &&
    totalCredits >= 0 && totalUsage >= 0
  ) {
    result.accountAvailable = true;
    result.totalCredits = totalCredits;
    result.totalUsage = totalUsage;
    result.remainingCredits = totalCredits - totalUsage;
  } else if (
    missingPermission || credits.status === 401 || credits.status === 403
  ) {
    result.requiresManagementKey = true;
    result.accountError = managementKey
      ? "OpenRouter hat den eingegebenen Management-Key nicht für die Guthabenabfrage zugelassen."
      : "Der Chat-Key darf das Kontoguthaben nicht abfragen. Dafür ist ein Management-Key nötig.";
  } else {
    result.accountError = credits.data
      ? "OpenRouter lieferte keine gültigen Kontoguthabenwerte."
      : "Das Kontoguthaben ist gerade nicht abrufbar. Bitte später erneut versuchen.";
  }
  return result;
}

export function keyAllowanceText(result: OpenRouterBalance): string {
  if (result.keyLimitState === "unlimited") {
    return "Kein eigenes Chat-Key-Limit; andere Anbieterlimits können gelten.";
  }
  if (result.keyLimitRemaining !== null) {
    return `Verbleibendes Chat-Key-Limit: $${
      result.keyLimitRemaining.toFixed(2)
    } (kein Kontoguthaben).`;
  }
  return result.keyLimitState === "limited" && result.keyLimit !== null
    ? `Chat-Key-Limit: $${
      result.keyLimit.toFixed(2)
    }; verbleibender Betrag unbekannt.`
    : "Chat-Key-Limit unbekannt (nicht mit unbegrenzt gleichzusetzen).";
}
