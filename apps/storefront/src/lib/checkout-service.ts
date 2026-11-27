import { StoreRequestError } from "./medusa-http.ts"
import { validId } from "./cart.ts"
import {
  addressIsComplete,
  checkoutCartProjection,
  CheckoutError,
  validateCheckoutMutation,
  normalizeCheckoutAddress,
} from "./checkout.ts"
import type { CheckoutState, CheckoutAddress, NormalizedAddress, ShippingOption } from "./checkout.ts"
import type { CheckoutApi, SavedCheckoutCart } from "./checkout-api.ts"
import type { Region } from "./store-api.ts"

export type CheckoutCookie = { read(): string | undefined; save?(id: string): void; clear?(): void }

function mapRequestError(error: unknown, operation: "retrieve" | "address" | "options" | "shipping"): CheckoutError {
  if (error instanceof CheckoutError) {
    // A write may have committed before an invalid or incomplete response was
    // observed. Preserve explicit validation/configuration failures, but make
    // an opaque backend response uncertain and require reconciliation.
    if (["address", "shipping"].includes(operation) && error.kind === "backend") return new CheckoutError("uncertain")
    return error
  }
  if (error instanceof StoreRequestError) {
    if ([401, 403].includes(error.status)) return new CheckoutError("configuration")
    if (error.status === 404) return new CheckoutError("missing")
    if (operation === "options") {
      // A malformed cart context (for example no fulfillment setup) is a
      // configuration failure; do not present an empty list as free shipping.
      if (error.status === 400) return new CheckoutError("configuration")
      return new CheckoutError("backend")
    }
    if (operation === "shipping") {
      if ([400, 422].includes(error.status)) return new CheckoutError("shipping_rejected")
      return new CheckoutError("uncertain")
    }
    if (operation === "address") {
      if ([400, 422].includes(error.status)) return new CheckoutError("address")
      return new CheckoutError("uncertain")
    }
    return new CheckoutError("backend")
  }
  return new CheckoutError(operation === "retrieve" || operation === "options" ? "backend" : "uncertain")
}

function addressMatches(address: CheckoutAddress | null, expected: NormalizedAddress): boolean {
  return !!address && address.firstName === expected.first_name && address.lastName === expected.last_name &&
    address.address1 === expected.address_1 && address.address2 === (expected.address_2 ?? null) &&
    address.city === expected.city && address.province === (expected.province ?? null) &&
    address.postalCode === expected.postal_code && address.countryCode === expected.country_code &&
    address.phone === (expected.phone ?? null) && address.company === (expected.company ?? null)
}

export function createCheckoutService({ api, region, cookie }: {
  api: CheckoutApi
  region: Region
  cookie: CheckoutCookie
}) {
  function check(saved: SavedCheckoutCart, expectedId?: string): SavedCheckoutCart {
    if (expectedId && saved.id !== expectedId) throw new CheckoutError("backend")
    if (saved.completed) throw new CheckoutError("completed")
    if (saved.regionId !== region.id || (saved.countryCode !== null && saved.countryCode !== region.countryCode) ||
        saved.cart.currencyCode !== region.currencyCode || (api.salesChannelId && saved.salesChannelId !== api.salesChannelId)) throw new CheckoutError("mismatch")
    return saved
  }
  function checkWrite(saved: SavedCheckoutCart, expectedId: string): SavedCheckoutCart {
    try {
      check(saved, expectedId)
      if (saved.countryCode !== region.countryCode) throw new CheckoutError("mismatch")
      return saved
    } catch { throw new CheckoutError("uncertain") }
  }
  async function load(): Promise<SavedCheckoutCart | null> {
    const id = cookie.read()
    if (id === undefined) return null
    if (!validId(id)) throw new CheckoutError("missing")
    let saved: SavedCheckoutCart
    try { saved = await api.retrieve(id) } catch (error) { throw mapRequestError(error, "retrieve") }
    check(saved, id)
    try { await api.validateSalesChannel(saved.salesChannelId) } catch (error) {
      throw mapRequestError(error, "retrieve")
    }
    return saved
  }
  async function requireCart(): Promise<SavedCheckoutCart> {
    const saved = await load()
    if (!saved) throw new CheckoutError("missing")
    return saved
  }
  async function optionsFor(saved: SavedCheckoutCart): Promise<ShippingOption[]> {
    try { return await api.listShippingOptions(saved.id, saved.cart.currencyCode) } catch (error) {
      throw mapRequestError(error, "options")
    }
  }
  function publicState(saved: SavedCheckoutCart, shippingOptions: ShippingOption[], shippingState: CheckoutState["shippingState"]): CheckoutState {
    return { cart: checkoutCartProjection(saved), shippingOptions, shippingState }
  }

  async function listShippingOptions(): Promise<ShippingOption[]> {
    const saved = await requireCart()
    if (!addressIsComplete(saved.shippingAddress, region.countryCode)) throw new CheckoutError("address")
    return optionsFor(saved)
  }
  return {
    async read(): Promise<CheckoutState> {
      let saved: SavedCheckoutCart | null
      try { saved = await load() } catch (error) {
        const safe = error instanceof CheckoutError ? error : new CheckoutError("backend")
        if (["missing", "completed", "mismatch"].includes(safe.kind)) {
          return { cart: null, shippingOptions: [], shippingState: "no-cart", issue: safe.kind as CheckoutState["issue"] }
        }
        throw safe
      }
      if (!saved) return { cart: null, shippingOptions: [], shippingState: "no-cart" }
      const cart = checkoutCartProjection(saved)
      if (!saved.cart.lines.length || !addressIsComplete(saved.shippingAddress, region.countryCode)) {
        return { cart, shippingOptions: [], shippingState: saved.cart.lines.length ? "address-required" : "none" }
      }
      try {
        const shippingOptions = await optionsFor(saved)
        return publicState(saved, shippingOptions, shippingOptions.length ? "available" : "none")
      } catch (error) {
        const safe = error instanceof CheckoutError ? error : new CheckoutError("backend")
        if (safe.kind === "configuration" || safe.kind === "backend") return publicState(saved, [], safe.kind)
        throw safe
      }
    },
    listShippingOptions,
    async mutate(value: unknown): Promise<void> {
      const input = validateCheckoutMutation(value)
      if (input.action === "list-shipping-options") {
        await listShippingOptions()
        return
      }
      if (input.action === "update-address") {
        const shippingAddress = normalizeCheckoutAddress(input.address, region.countryCode)
        const billingAddress = input.useSameBilling ? shippingAddress : undefined
        const saved = await requireCart()
        let updated: SavedCheckoutCart
        try { updated = await api.updateAddress(saved.id, shippingAddress, billingAddress) } catch (error) {
          throw mapRequestError(error, "address")
        }
        checkWrite(updated, saved.id)
        if (!addressMatches(updated.shippingAddress, shippingAddress) ||
            (billingAddress && !addressMatches(updated.billingAddress, billingAddress))) throw new CheckoutError("uncertain")
        return
      }
      const saved = await requireCart()
      if (!addressIsComplete(saved.shippingAddress, region.countryCode)) throw new CheckoutError("address")
      const available = await optionsFor(saved)
      const selected = available.find((option) => option.id === input.optionId)
      if (!selected) throw new CheckoutError("option")
      if (selected.insufficientInventory) throw new CheckoutError("shipping_rejected")
      let updated: SavedCheckoutCart
      try { updated = await api.addShippingMethod(saved.id, selected.id) } catch (error) {
        throw mapRequestError(error, "shipping")
      }
      checkWrite(updated, saved.id)
      if (!updated.shippingMethods.some((method) => method.optionId === selected.id)) throw new CheckoutError("uncertain")
      return
    },
  }
}
export type CheckoutService = ReturnType<typeof createCheckoutService>
