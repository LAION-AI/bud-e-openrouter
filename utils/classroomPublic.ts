/** Public checks must time out independently of the model/chat requests. */
export async function fetchClassroomPublic<T>(
  slug: string,
  signal: AbortSignal,
  timeoutMs = 12_000,
  request: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(
      `/api/classroom?action=public&slug=${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error("Freigabeprüfung fehlgeschlagen");
    const value = await response.json();
    if (
      !value || typeof value.active !== "boolean" ||
      typeof value.exists !== "boolean"
    ) {
      throw new Error("Ungültige Freigabeantwort");
    }
    return value as T;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
