import type { Store } from "@medusajs/js-sdk"
import { safeImageUrl } from "./catalog.ts"
import { CartError, validId } from "./cart.ts"
import type { Cart, CartLine } from "./cart.ts"
import { createMedusaRequest, StoreRequestError } from "./medusa-http.ts"
import type { Region, StoreEnvironment } from "./store-api.ts"

export type SavedCart = { id: string; regionId: string; countryCode: string | null; salesChannelId: string | null; completed: boolean; cart: Cart }
const fields = "id,region_id,shipping_address.country_code,currency_code,sales_channel_id,completed_at,subtotal,total,tax_total,discount_total,items.id,items.variant_id,items.product_handle,items.product_title,items.title,items.variant_title,items.thumbnail,items.quantity,items.unit_price,items.is_tax_inclusive,items.total,items.subtotal"
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) }
function invalid(): never { throw new CartError("backend") }
export function toSavedCart(raw: unknown): SavedCart {
  if (!record(raw) || !validId(raw.id) || !validId(raw.region_id) || typeof raw.currency_code !== "string" || !/^[a-z]{3}$/i.test(raw.currency_code) ||
    !(raw.sales_channel_id === null || validId(raw.sales_channel_id)) || !(raw.completed_at === null || typeof raw.completed_at === "string") || !Array.isArray(raw.items)) invalid()
  const currencyCode = raw.currency_code.toLowerCase()
  let countryCode: string | null = null
  if (raw.shipping_address != null) {
    if (!record(raw.shipping_address) || typeof raw.shipping_address.country_code !== "string" || !/^[a-z]{2}$/i.test(raw.shipping_address.country_code)) invalid()
    countryCode = raw.shipping_address.country_code.toLowerCase()
  }
  function amount(value: unknown) {
    if (value === null || value === undefined) return null
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid()
    return { amount: value, currencyCode }
  }
  const ids = new Set<string>()
  const lines: CartLine[] = raw.items.map((item) => {
    if (!record(item) || !validId(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1) invalid()
    ids.add(item.id)
    const unitPrice = amount(item.unit_price)
    if (!unitPrice) invalid()
    return {
      id: item.id, variantId: validId(item.variant_id) ? item.variant_id : null,
      handle: typeof item.product_handle === "string" ? item.product_handle : null,
      title: typeof item.product_title === "string" ? item.product_title : typeof item.title === "string" ? item.title : "Cart item",
      variantTitle: typeof item.variant_title === "string" ? item.variant_title : null,
      thumbnail: safeImageUrl(item.thumbnail), quantity: Number(item.quantity), unitPrice,
      total: amount(item.total), subtotal: amount(item.subtotal), taxInclusive: typeof item.is_tax_inclusive === "boolean" ? item.is_tax_inclusive : null,
    }
  })
  return {
    id: raw.id, regionId: raw.region_id, countryCode, salesChannelId: raw.sales_channel_id, completed: raw.completed_at !== null,
    cart: { currencyCode, lines, subtotal: amount(raw.subtotal), total: amount(raw.total), taxTotal: amount(raw.tax_total), discountTotal: amount(raw.discount_total) },
  }
}

export function createCartApi(env: StoreEnvironment, fetcher: typeof fetch = fetch) {
  let request: ReturnType<typeof createMedusaRequest>
  try { request = createMedusaRequest(env, fetcher) } catch { throw new CartError("configuration") }
  const salesChannelId = env.MEDUSA_SALES_CHANNEL_ID?.trim() || undefined
  if (salesChannelId && !validId(salesChannelId)) throw new CartError("configuration")
  async function call(path: string, method: "GET" | "POST" | "DELETE", body?: object): Promise<SavedCart> {
    try {
      const data = await request(path, new URLSearchParams({ fields }), method, body)
      return toSavedCart(method === "DELETE" ? data.parent : data.cart)
    } catch (error) {
      if (error instanceof CartError) {
        // A successful write with an invalid response may still have committed.
        if (method !== "GET") throw new CartError("uncertain")
        throw error
      }
      if (error instanceof StoreRequestError) {
        if ([401, 403].includes(error.status)) throw new CartError("configuration")
        if (method === "GET" && error.status === 404) throw new CartError("missing")
        if (method !== "GET" && [400, 409, 422].includes(error.status)) {
          throw new CartError(error.type === "insufficient_inventory" ? "stock" : "rejected")
        }
      }
      throw new CartError(method === "GET" ? "backend" : "uncertain")
    }
  }
  function path(id: string) {
    if (!validId(id)) throw new CartError("input")
    return `store/carts/${encodeURIComponent(id)}`
  }
  return {
    salesChannelId,
    async validateSalesChannel(id: string | null) {
      if (!id) throw new CartError("mismatch")
      if (salesChannelId) {
        if (id !== salesChannelId) throw new CartError("mismatch")
        return
      }
      // Medusa 2.23 only authorizes a cart's channel on creation, not retrieval
      // or line writes. The product middleware validates an explicitly requested
      // channel against the current key, even if that channel has no products.
      try {
        const data = await request("store/products", new URLSearchParams({ sales_channel_id: id, fields: "id", limit: "1" }))
        if (!Array.isArray(data.products) || !Number.isSafeInteger(data.count) || Number(data.count) < 0) throw new CartError("backend")
      } catch (error) {
        if (error instanceof CartError) throw error
        if (error instanceof StoreRequestError && error.status === 400) throw new CartError("mismatch")
        if (error instanceof StoreRequestError && [401, 403].includes(error.status)) throw new CartError("configuration")
        throw new CartError("backend")
      }
    },
    retrieve: (id: string) => call(path(id), "GET"),
    create(region: Region) {
      const body: Parameters<Store["cart"]["create"]>[0] = { region_id: region.id, currency_code: region.currencyCode, shipping_address: { country_code: region.countryCode }, ...(salesChannelId ? { sales_channel_id: salesChannelId } : {}) }
      return call("store/carts", "POST", body)
    },
    add(id: string, variantId: string, quantity: number) {
      const body: Parameters<Store["cart"]["createLineItem"]>[1] = { variant_id: variantId, quantity }
      return call(`${path(id)}/line-items`, "POST", body)
    },
    update(id: string, lineId: string, quantity: number) {
      const body: Parameters<Store["cart"]["updateLineItem"]>[2] = { quantity }
      return call(`${path(id)}/line-items/${encodeURIComponent(lineId)}`, "POST", body)
    },
    remove: (id: string, lineId: string) => call(`${path(id)}/line-items/${encodeURIComponent(lineId)}`, "DELETE"),
  }
}
export type CartApi = ReturnType<typeof createCartApi>
