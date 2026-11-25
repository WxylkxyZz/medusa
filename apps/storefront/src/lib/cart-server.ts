import "server-only"
import { cookies } from "next/headers"
import { CartError } from "./cart"
import { createCartApi } from "./cart-api"
import { createCartService } from "./cart-service"
import { CART_COOKIE, cartCookiePolicy } from "./cart-policy"
import { CatalogError } from "./store-api"
import { getStore, readStoreEnvironment } from "./store"

// Keep the public base URL runtime-readable too: local production uses plain HTTP.
export const runtimeBaseUrl = (): string | undefined => Reflect.get(process.env, "NEXT_PUBLIC_BASE_URL")
export async function getCartCookie() {
  const jar = await cookies()
  const { options } = cartCookiePolicy(runtimeBaseUrl())
  return {
    read: () => jar.get(CART_COOKIE)?.value,
    save: (id: string) => jar.set(CART_COOKIE, id, options),
    clear: () => jar.set(CART_COOKIE, "", { ...options, maxAge: 0 }),
  }
}
export async function getCartService() {
  const cookie = await getCartCookie()
  try {
    const { api, region } = await getStore()
    return createCartService({ api: createCartApi(readStoreEnvironment()), region, cookie, getProduct: (handle) => api.getProduct(region, handle) })
  } catch (error) {
    if (error instanceof CatalogError) throw new CartError(error.kind === "backend" ? "backend" : "configuration")
    throw error
  }
}
export function safeCartError(error: unknown): CartError {
  if (error instanceof CartError) return error
  if (error instanceof CatalogError) return new CartError(error.kind === "backend" ? "backend" : "configuration")
  return new CartError("backend")
}
