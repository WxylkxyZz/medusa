import type { MetadataRoute } from "next"
import { productHref } from "./catalog.ts"

// Public, indexable routes. Cart and checkout are intentionally absent: both
// send noindex and carry guest state.
export const PUBLIC_PATHS = ["/", "/store", "/shipping", "/returns"] as const
export const ROBOTS_DISALLOW = ["/cart", "/checkout", "/api/"] as const

// Sitemap entries are absolute URLs, so no origin means no sitemap instead of
// relative or guessed hosts.
export function sitemapEntries(origin: string | null, handles: readonly string[]): MetadataRoute.Sitemap {
  if (!origin) return []
  const urls = new Set<string>(PUBLIC_PATHS.map((path) => `${origin}${path}`))
  for (const handle of handles) {
    if (typeof handle !== "string" || !handle || handle === "." || handle === "..") continue
    urls.add(`${origin}${productHref(handle)}`)
  }
  return [...urls].map((url) => ({ url }))
}

export function buildRobots(origin: string | null): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  }
}
