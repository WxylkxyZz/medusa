import type { MetadataRoute } from "next"
import { buildRobots } from "@/lib/seo"
import { siteOrigin } from "@/lib/site"

export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteOrigin())
}
