import "server-only"
import { CartError } from "./cart.ts"
import { createCheckoutApi } from "./checkout-api.ts"
import { CheckoutError } from "./checkout.ts"
import { createCheckoutService } from "./checkout-service.ts"
import { CatalogError } from "./store-api.ts"
import { getStore, readStoreEnvironment } from "./store.ts"
import { getCartCookie, runtimeBaseUrl } from "./cart-server.ts"

export async function getCheckoutService() {
  const cookie = await getCartCookie()
  try {
    const { region } = await getStore()
    return createCheckoutService({ api: createCheckoutApi(readStoreEnvironment()), region, cookie })
  } catch (error) {
    if (error instanceof CatalogError) throw new CheckoutError(error.kind === "backend" ? "backend" : "configuration")
    if (error instanceof CartError) {
      throw new CheckoutError(error.kind === "origin" ? "origin" : error.kind === "backend" ? "backend" : "configuration")
    }
    throw error
  }
}

export function safeCheckoutError(error: unknown): CheckoutError {
  if (error instanceof CheckoutError) return error
  if (error instanceof CatalogError) return new CheckoutError(error.kind === "backend" ? "backend" : "configuration")
  if (error instanceof CartError) return new CheckoutError(error.kind === "origin" ? "origin" : error.kind === "backend" ? "backend" : "configuration")
  return new CheckoutError("backend")
}

export { runtimeBaseUrl }
