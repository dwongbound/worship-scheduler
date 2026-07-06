// Small client-side fetch helpers.

/**
 * Fetch a URL that is expected to return a JSON array. Returns [] on any
 * network error, non-2xx response, or non-array body, so callers can render
 * an empty list instead of crashing on `.map(...)`.
 */
export async function fetchJsonArray<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
