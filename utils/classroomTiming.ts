/** Choices shared by the teacher UI and the activation endpoint. */
export const CLASSROOM_DURATIONS = [
  { minutes: 30, label: "30 Minuten" },
  { minutes: 60, label: "1 Stunde" },
  { minutes: 120, label: "2 Stunden" },
  { minutes: 240, label: "4 Stunden" },
  { minutes: 480, label: "8 Stunden" },
  { minutes: 1440, label: "24 Stunden" },
  { minutes: 3 * 1440, label: "3 Tage" },
  { minutes: 7 * 1440, label: "7 Tage" },
  { minutes: 14 * 1440, label: "14 Tage" },
  { minutes: 30 * 1440, label: "30 Tage" },
] as const;

export const MAX_CLASSROOM_DURATION_MS = 30 * 24 * 60 * 60_000;

export function validClassroomDuration(minutes: number): boolean {
  return CLASSROOM_DURATIONS.some((option) => option.minutes === minutes);
}
