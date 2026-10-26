/** Server-side fallback for consent when an island has not hydrated. */
import {
  learningPathQuery,
  parseLearningPathTarget,
} from "./learningPathLinks.ts";
export const AGREEMENT_COOKIE = "__Host-bude-agreement";

export function hasAgreementCookie(req: Request): boolean {
  return new RegExp(`(?:^|;\\s*)${AGREEMENT_COOKIE}=1(?:;|$)`).test(
    req.headers?.get("cookie") ?? "",
  );
}

export function agreementCookie(): string {
  return `${AGREEMENT_COOKIE}=1; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

export function agreementReturnTo(value: unknown): string | null {
  if (value === "/") return "/";
  if (typeof value === "string") {
    const match = value.match(/^\/(?:([a-z][a-z0-9]{2,23}))?(\?lernpfad=.*)$/);
    const target = match && parseLearningPathTarget(match[2]);
    if (target && value === `/${match[1] ?? ""}${learningPathQuery(target)}`) {
      return value;
    }
  }
  if (typeof value === "string" && /^\/[a-z][a-z0-9]{2,23}$/.test(value)) {
    return value;
  }
  return null;
}
