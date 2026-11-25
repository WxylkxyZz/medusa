import { CartError } from "./cart.ts"

export const CART_COOKIE = "medusa_guest_cart"
export function cartCookiePolicy(baseUrl: string | undefined) {
  try {
    if (!baseUrl) throw new Error()
    const url = new URL(baseUrl)
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error()
    return { origin: url.origin, options: { httpOnly: true, sameSite: "lax" as const, secure: url.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 } }
  } catch { throw new CartError("configuration") }
}
export function verifyCartOrigin(headers: Headers, configuredBase: string | undefined) {
  const policy = cartCookiePolicy(configuredBase)
  // Origin is mandatory, never inferred from attacker-supplied Host/forwarded headers.
  const site = headers.get("sec-fetch-site")
  if (headers.get("origin") !== policy.origin || (site !== null && site !== "same-origin") ||
    headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new CartError("origin")
  return policy
}
