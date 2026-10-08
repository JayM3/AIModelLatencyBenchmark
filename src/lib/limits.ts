/** Hard limits for benchmark requests. */
export const LIMITS = {
  runs: [1, 20],
  concurrency: [1, 5],
  maxTokens: [1, 4096],
  temperature: [0, 2],
} as const;

type LimitName = keyof typeof LIMITS;

/** Clamp request values, keeping counts integral and valid zero temperatures. */
export function clamp(value: unknown, limit: LimitName, fallback: number): number {
  const [min, max] = LIMITS[limit];
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : fallback;
  const bounded = Math.min(Math.max(Number.isFinite(numeric) ? numeric : fallback, min), max);
  return limit === "temperature" ? bounded : Math.trunc(bounded);
}

