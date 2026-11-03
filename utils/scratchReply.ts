import { inspectScratchReply, type ScratchProposal } from "./scratchTools.ts";

/** Only validation failures are repaired. Apply is performed at most once. */
export async function resolveScratchReply(
  reply: string,
  options: {
    directEdit: boolean;
    allowed: () => boolean;
    prepare: (proposal: ScratchProposal) => Promise<string>;
    apply: () => Promise<void>;
    repair: (reply: string, error: string) => Promise<string>;
  },
): Promise<string | null> {
  reply = typeof reply === "string" ? reply : "";
  for (let attempt = 0; attempt <= 2; attempt++) {
    if (!options.allowed()) {
      throw new Error(
        "Scratch-Freigabe wurde aufgehoben. Dein Projekt wurde nicht geändert.",
      );
    }
    const result = inspectScratchReply(reply);
    if (
      attempt === 0 && !result.proposal && !result.attempted &&
      !options.directEdit
    ) {
      return null;
    }
    let error = result.error;
    if (result.proposal) {
      let receipt: string | undefined;
      try {
        receipt = await options.prepare(result.proposal);
      } catch (cause) {
        error = cause instanceof Error
          ? cause.message
          : "Scratch-Auftrag konnte nicht geprüft werden.";
      }
      if (receipt !== undefined) {
        if (!options.directEdit) return receipt;
        // An apply timeout has an uncertain outcome; never resubmit automatically.
        await options.apply();
        return "Dein Scratch-Projekt wurde auf deine Bitte geändert. Öffne Scratch, um das Ergebnis zu sehen. Mit „KI-Änderung rückgängig“ kannst du es zurücknehmen.\n\n" +
          result.proposal.summary;
      }
    }
    if (attempt === 2) {
      throw new Error(
        "Scratch konnte die KI-Antwort auch nach zwei Korrekturversuchen nicht übernehmen: " +
          error +
          " Dein Projekt bleibt unverändert. Bitte den Auftrag kleiner formulieren oder ein anderes Modell wählen.",
      );
    }
    if (!options.allowed()) {
      throw new Error(
        "Scratch-Freigabe wurde aufgehoben. Dein Projekt wurde nicht geändert.",
      );
    }
    const repaired = await options.repair(reply, error);
    reply = typeof repaired === "string" ? repaired : "";
  }
  return null;
}
