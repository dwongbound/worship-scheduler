// Small client-side fetch helpers.

/**
 * Fetch a URL that is expected to return a JSON array. Returns [] on any
 * network error, non-2xx response, or non-array body, so callers can render
 * an empty list instead of crashing on `.map(...)`.
 */
export async function fetchJsonArray<T>(
  url: string,
  init?: RequestInit
): Promise<T[]> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Header that names the org an admin request operates on. Admin collection
 * routes require it (server verifies the caller is an admin of THAT org).
 */
export function orgHeaders(orgId: string): Record<string, string> {
  return { "x-org-id": orgId };
}
