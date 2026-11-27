import type { MetadataRoute } from "next"
import { getStore } from "@/lib/store"
import { siteOrigin } from "@/lib/site"
import { sitemapEntries } from "@/lib/seo"

export const dynamic = "force-dynamic"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()
  if (!origin) return []
  try {
    const { api, region } = await getStore()
    const handles: string[] = []
    // The catalog API is paged and bounded. A build never evaluates this
    // route; production requests discover the currently published catalog.
    for (let page = 1; page <= 10000; page += 1) {
      const result = await api.listProductHandles(region, page)
      handles.push(...result.handles)
      if (handles.length >= result.count || result.handles.length === 0) break
    }
    return sitemapEntries(origin, handles)
  } catch {
    // Static public routes remain useful when the catalog backend is down.
    return sitemapEntries(origin, [])
  }
}
