import "server-only"
import { resolveSiteOrigin } from "./site-url.ts"

// Reflect.get keeps NEXT_PUBLIC_BASE_URL readable at request time; Next's
// public-variable pass would otherwise inline the build value.
const readEnv = (name: string): string | undefined => Reflect.get(process.env, name)

export function siteOrigin(): string | null {
  return resolveSiteOrigin(readEnv("NEXT_PUBLIC_BASE_URL"))
}
