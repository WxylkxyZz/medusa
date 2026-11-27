import { createMedusaRequest, StoreRequestError } from "./medusa-http.ts"
import { toSavedCart } from "./cart-api.ts"
import type { SavedCart } from "./cart-api.ts"
import { validId } from "./cart.ts"
import {
  CheckoutError,
  projectCheckoutAddress,
  projectShippingMethod,
  projectShippingOptions,
} from "./checkout.ts"
import type { CheckoutAddress, NormalizedAddress, ShippingMethod, ShippingOption } from "./checkout.ts"
import type { Price } from "./catalog.ts"
import type { StoreEnvironment } from "./store-api.ts"

// Keep this list explicit. It contains only the cart fields needed to render
// checkout and reconcile totals after a write; metadata, provider data, and
// address IDs never leave the server boundary.
export const checkoutCartFields = [
  "id", "region_id", "currency_code", "sales_channel_id", "completed_at",
  "subtotal", "item_subtotal", "total", "tax_total", "discount_total", "shipping_total",
  "items.id", "items.variant_id", "items.product_handle", "items.product_title", "items.title", "items.variant_title",
  "items.thumbnail", "items.quantity", "items.unit_price", "items.is_tax_inclusive", "items.total", "items.subtotal",
  "shipping_address.first_name", "shipping_address.last_name", "shipping_address.company", "shipping_address.address_1",
  "shipping_address.address_2", "shipping_address.city", "shipping_address.postal_code", "shipping_address.country_code",
  "shipping_address.province", "shipping_address.phone",
  "billing_address.first_name", "billing_address.last_name", "billing_address.company", "billing_address.address_1",
  "billing_address.address_2", "billing_address.city", "billing_address.postal_code", "billing_address.country_code",
  "billing_address.province", "billing_address.phone",
  "shipping_methods.name", "shipping_methods.amount", "shipping_methods.is_tax_inclusive",
  "shipping_methods.shipping_option_id",
].join(",")

export const shippingOptionFields = [
  "id", "name", "price_type", "calculated_price.currency_code", "calculated_price.calculated_amount", "calculated_price.is_calculated_price_tax_inclusive",
].join(",")

export type SavedCheckoutCart = Omit<SavedCart, "cart"> & {
  cart: SavedCart["cart"] & { shippingTotal: Price | null }
  shippingAddress: CheckoutAddress | null
  billingAddress: CheckoutAddress | null
  shippingMethods: ShippingMethod[]
}

function cartAmount(value: unknown, currencyCode: string): Price | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalidResponse()
  return { amount: value, currencyCode }
}
function cartParams() { return new URLSearchParams({ fields: checkoutCartFields }) }
function invalidResponse(): never { throw new CheckoutError("backend") }

export function toSavedCheckoutCart(raw: unknown): SavedCheckoutCart {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalidResponse()
  try {
    const value = raw as Record<string, unknown>
    const saved = toSavedCart(value)
    if (value.shipping_methods !== undefined && !Array.isArray(value.shipping_methods)) invalidResponse()
    const shippingMethods = (value.shipping_methods ?? []).map((method) => projectShippingMethod(method, saved.cart.currencyCode))
    const ids = new Set<string>()
    for (const method of shippingMethods) {
      if (ids.has(method.optionId)) invalidResponse()
      ids.add(method.optionId)
    }
    return {
      ...saved,
      cart: { ...saved.cart, shippingTotal: cartAmount(value.shipping_total, saved.cart.currencyCode) },
      shippingAddress: projectCheckoutAddress(value.shipping_address),
      billingAddress: projectCheckoutAddress(value.billing_address),
      shippingMethods,
    }
  } catch (error) {
    if (error instanceof CheckoutError) throw error
    throw new CheckoutError("backend")
  }
}

export function createCheckoutApi(env: StoreEnvironment, fetcher: typeof fetch = fetch) {
  let request: ReturnType<typeof createMedusaRequest>
  try { request = createMedusaRequest(env, fetcher) } catch { throw new CheckoutError("configuration") }
  const salesChannelId = env.MEDUSA_SALES_CHANNEL_ID?.trim() || undefined
  if (salesChannelId && !validId(salesChannelId)) throw new CheckoutError("configuration")

  function cartPath(id: string): string {
    if (!validId(id)) throw new CheckoutError("input")
    return `store/carts/${encodeURIComponent(id)}`
  }
  async function cartCall(path: string, method: "GET" | "POST", body?: object): Promise<SavedCheckoutCart> {
    const data = await request(path, cartParams(), method, body)
    return toSavedCheckoutCart(data.cart)
  }

  return {
    salesChannelId,
    retrieve(id: string) { return cartCall(cartPath(id), "GET") },
    updateAddress(id: string, shippingAddress: NormalizedAddress, billingAddress?: NormalizedAddress) {
      return cartCall(cartPath(id), "POST", { shipping_address: shippingAddress, ...(billingAddress ? { billing_address: billingAddress } : {}) })
    },
    listShippingOptions: async (id: string, currencyCode: string): Promise<ShippingOption[]> => {
      if (!validId(id)) throw new CheckoutError("input")
      const data = await request("store/shipping-options", new URLSearchParams({
        cart_id: id,
        is_return: "false",
        fields: shippingOptionFields,
      }))
      if (!Array.isArray(data.shipping_options)) invalidResponse()
      return projectShippingOptions(data.shipping_options, currencyCode)
    },
    addShippingMethod(id: string, optionId: string) {
      if (!validId(optionId)) throw new CheckoutError("input")
      return cartCall(`${cartPath(id)}/shipping-methods`, "POST", { option_id: optionId })
    },
    async validateSalesChannel(id: string | null) {
      if (!id) throw new CheckoutError("mismatch")
      if (salesChannelId) {
        if (id !== salesChannelId) throw new CheckoutError("mismatch")
        return
      }
      try {
        const data = await request("store/products", new URLSearchParams({ sales_channel_id: id, fields: "id", limit: "1" }))
        if (!Array.isArray(data.products) || !Number.isSafeInteger(data.count) || Number(data.count) < 0) invalidResponse()
      } catch (error) {
        if (error instanceof CheckoutError) throw error
        if (error instanceof StoreRequestError && error.status === 400) throw new CheckoutError("mismatch")
        if (error instanceof StoreRequestError && [401, 403].includes(error.status)) throw new CheckoutError("configuration")
        throw new CheckoutError("backend")
      }
    },
  }
}
export type CheckoutApi = ReturnType<typeof createCheckoutApi>
