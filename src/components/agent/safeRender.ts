export function safeJsonPreview(value: unknown, fallback = "", maxLength = 4000): string {
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(
      value,
      (_key, item) => {
        if (typeof item === "bigint") return String(item);
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      },
      2
    );
    return (text || fallback).slice(0, maxLength);
  } catch {
    return fallback;
  }
}

export function safeString(value: unknown, fallback = "", maxLength = 4000): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.slice(0, maxLength);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).slice(0, maxLength);
  }
  if (Array.isArray(value)) {
    const text = value.map((item) => safeString(item)).filter(Boolean).join(", ");
    return (text || fallback).slice(0, maxLength);
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of ["title", "name", "tool", "type", "status", "message", "command", "path", "file", "text", "content", "id"]) {
      const nested = item[key];
      if (nested !== undefined && nested !== null && typeof nested !== "object") {
        return String(nested).slice(0, maxLength);
      }
    }
    return safeJsonPreview(value, fallback, maxLength);
  }
  return fallback;
}

export function safeClassToken(value: unknown, fallback = "unknown"): string {
  const text = safeString(value, fallback).toLowerCase().trim();
  return text.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function displayCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
