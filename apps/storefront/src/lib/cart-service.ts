import { canPurchase } from "./catalog.ts"
import type { Product } from "./catalog.ts"
import { CartError, MAX_QUANTITY, validId, validateMutation } from "./cart.ts"
import type { CartState } from "./cart.ts"
import type { CartApi, SavedCart } from "./cart-api.ts"
import type { Region } from "./store-api.ts"

export type CartCookie = { read(): string | undefined; save(id: string): void; clear(): void }
export function createCartService({ api, region, cookie, getProduct }: {
  api: CartApi; region: Region; cookie: CartCookie; getProduct(handle: string): Promise<Product | null>
}) {
  function check(saved: SavedCart, expectedId?: string) {
    if (expectedId && saved.id !== expectedId) throw new CartError("backend")
    if (saved.completed) throw new CartError("completed")
    if (saved.regionId !== region.id || saved.countryCode !== region.countryCode || saved.cart.currencyCode !== region.currencyCode ||
      (api.salesChannelId && saved.salesChannelId !== api.salesChannelId)) throw new CartError("mismatch")
    return saved
  }
  function checkWrite(saved: SavedCart, expectedId: string) {
    try { return check(saved, expectedId) } catch { throw new CartError("uncertain") }
  }
  async function load(): Promise<SavedCart | null> {
    const id = cookie.read()
    if (id === undefined) return null
    if (!validId(id)) throw new CartError("missing")
    const saved = check(await api.retrieve(id), id)
    await api.validateSalesChannel(saved.salesChannelId)
    return saved
  }
  return {
    async read(): Promise<CartState> {
      try { return { cart: (await load())?.cart ?? null } } catch (error) {
        if (error instanceof CartError && ["missing", "completed", "mismatch"].includes(error.kind)) {
          return { cart: null, issue: error.kind as CartState["issue"] }
        }
        throw error
      }
    },
    async mutate(value: unknown) {
      const input = validateMutation(value)
      if (input.action === "reset") {
        // This only forgets this browser's pointer. Never delete a remote cart/order.
        cookie.clear()
        return
      }
      let saved = await load()
      if (input.action === "add") {
        // Store cart API doesn't enforce product sales-channel availability itself.
        // Re-fetch the published catalog product in the exact region/channel context.
        const product = await getProduct(input.handle)
        const variant = product?.variants.find((entry) => entry.id === input.variantId)
        if (!product || !variant || product.options.some((option) => !variant.options.some((entry) => entry.optionId === option.id && option.values.includes(entry.value)))) throw new CartError("variant")
        const quantity = (saved?.cart.lines.filter((line) => line.variantId === input.variantId).reduce((sum, line) => sum + line.quantity, 0) ?? 0) + input.quantity
        if (quantity > MAX_QUANTITY) throw new CartError("input")
        if (!canPurchase(variant, quantity)) throw new CartError(variant.price ? "stock" : "variant")
        if (!saved) {
          saved = check(await api.create(region))
          // Persist before adding: a failed/uncertain add must not orphan the cart.
          cookie.save(saved.id)
        }
        const updated = await api.add(saved.id, input.variantId, input.quantity)
        checkWrite(updated, saved.id)
      } else {
        const line = saved?.cart.lines.find((entry) => entry.id === input.lineId)
        if (!saved || !line) throw new CartError("line")
        if (input.action === "update" && input.quantity > line.quantity) {
          // Increasing an existing line is still buying more: enforce the same
          // published/channel visibility boundary as an add. Decreases remain available.
          if (!line.handle || !line.variantId) throw new CartError("variant")
          const product = await getProduct(line.handle)
          const variant = product?.variants.find((entry) => entry.id === line.variantId)
          if (!product || !variant || product.options.some((option) => !variant.options.some((entry) => entry.optionId === option.id && option.values.includes(entry.value)))) throw new CartError("variant")
        }
        const updated = input.action === "remove" ? await api.remove(saved.id, input.lineId) : await api.update(saved.id, input.lineId, input.quantity)
        checkWrite(updated, saved.id)
      }
    },
  }
}
