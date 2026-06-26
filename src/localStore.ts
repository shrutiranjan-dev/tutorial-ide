// Simple resilient wrapper around window.localStorage.
// Falls back to an in‑memory Map when localStorage is unavailable (e.g., private‑mode).

const fallback = new Map<string, string>();

/**
 * Retrieve a string value from storage.
 * Returns `null` if the key does not exist.
 */
export function getItem(key: string): string | null {
  try {
    // `window` is guaranteed in the browser context; guard against absence.
    return window.localStorage.getItem(key);
  } catch {
    return fallback.has(key) ? fallback.get(key)! : null;
  }
}

/**
 * Store a string value.
 */
export function setItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    fallback.set(key, value);
  }
}
