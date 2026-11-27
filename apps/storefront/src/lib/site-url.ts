// Pure URL guard kept outside the server-only boundary so it can be tested
// offline. Next substitutes NEXT_PUBLIC_* values at build time; callers must
// read the environment at request time and pass the value here.
export function resolveSiteOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (!["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") return null
    return url.origin
  } catch {
    return null
  }
}
