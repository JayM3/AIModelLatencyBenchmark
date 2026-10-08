import { normalizeSavedBenchmark } from "./saved-benchmark.ts";
import type { SavedBenchmark } from "./types";

export const LOCAL_STORAGE_HISTORY_KEY = "benchroom_saved_history_v1";

/**
 * Reads saved benchmark history from browser localStorage.
 */
export function getLocalHistory(): SavedBenchmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeSavedBenchmark) : [];
  } catch (error) {
    console.warn("Failed to read history from localStorage:", error);
    return [];
  }
}

/**
 * Persists saved benchmark history to browser localStorage.
 */
export function setLocalHistory(items: SavedBenchmark[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(items.map(normalizeSavedBenchmark)));
  } catch (error) {
    console.warn("Failed to save history to localStorage:", error);
  }
}

/**
 * Fetches saved benchmark runs from server API with localStorage fallback.
 */
export async function fetchHistory(): Promise<SavedBenchmark[]> {
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history)) {
        // Update local storage cache
        setLocalHistory(data.history);
        return data.history;
      }
    }
  } catch (err) {
    console.warn("Unable to fetch server history, falling back to local storage:", err);
  }
  return getLocalHistory();
}

/**
 * Saves a benchmark run both to the server API and localStorage.
 */
export async function persistBenchmark(benchmark: SavedBenchmark): Promise<SavedBenchmark[]> {
  benchmark = normalizeSavedBenchmark(benchmark);
  // Update local storage first
  const local = getLocalHistory();
  const existingIdx = local.findIndex((item) => item.id === benchmark.id);
  const updatedLocal = existingIdx >= 0
    ? local.map((item) => (item.id === benchmark.id ? benchmark : item))
    : [benchmark, ...local];
  setLocalHistory(updatedLocal);

  // Attempt server persistence
  try {
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(benchmark),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history)) {
        setLocalHistory(data.history);
        return data.history;
      }
    }
  } catch (err) {
    console.warn("Unable to persist to server, stored in localStorage:", err);
  }

  return updatedLocal;
}

/**
 * Deletes a benchmark run from server and localStorage.
 */
export async function removeBenchmark(id: string): Promise<SavedBenchmark[]> {
  const local = getLocalHistory();
  const updatedLocal = id === "all" ? [] : local.filter((item) => item.id !== id);
  setLocalHistory(updatedLocal);

  try {
    const url = `/api/history?id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history)) {
        setLocalHistory(data.history);
        return data.history;
      }
    }
  } catch (err) {
    console.warn("Unable to delete on server:", err);
  }

  return updatedLocal;
}

/**
 * Nicely formats an ISO date for the history table.
 */
export function formatHistoryDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Human relative time (e.g., "just now", "5m ago").
 */
export function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 10) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}
