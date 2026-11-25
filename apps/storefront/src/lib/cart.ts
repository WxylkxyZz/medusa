import type { Price } from "./catalog.ts"

export const MAX_QUANTITY = 99
export type CartLine = {
  id: string; variantId: string | null; handle: string | null; title: string; variantTitle: string | null
  thumbnail: string | null; quantity: number; unitPrice: Price; total: Price | null; subtotal: Price | null; taxInclusive: boolean | null
}
export type Cart = {
  currencyCode: string; lines: CartLine[]
  subtotal: Price | null; total: Price | null; taxTotal: Price | null; discountTotal: Price | null
}
export type CartIssue = "configuration" | "backend" | "uncertain" | "input" | "stock" | "rejected" | "missing" | "completed" | "mismatch" | "line" | "variant" | "origin"
export class CartError extends Error {
  kind: CartIssue
  constructor(kind: CartIssue) { super(kind); this.name = "CartError"; this.kind = kind }
}
export type CartState = { cart: Cart | null; issue?: "missing" | "completed" | "mismatch" }
export type CartMutation =
  | { action: "add"; handle: string; variantId: string; quantity: number }
  | { action: "update"; lineId: string; quantity: number }
  | { action: "remove"; lineId: string }
  | { action: "reset" }
export type MutationResult = { ok: boolean; message: string; uncertain?: boolean }

export function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}
export function validateMutation(value: unknown): CartMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CartError("input")
  const input = value as Record<string, unknown>
  const fields = { add: ["action", "handle", "variantId", "quantity"], update: ["action", "lineId", "quantity"], remove: ["action", "lineId"], reset: ["action"] }
  if (typeof input.action !== "string" || !Object.hasOwn(fields, input.action)) throw new CartError("input")
  const keys = fields[input.action as keyof typeof fields]
  if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) throw new CartError("input")
  if (input.action === "add" || input.action === "update") {
    if (typeof input.quantity !== "number" || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) throw new CartError("input")
  }
  if (input.action === "add" && (!validId(input.variantId) || typeof input.handle !== "string" || !input.handle.length || input.handle.length > 256 || [".", ".."].includes(input.handle) || /[\u0000-\u001f\u007f]/.test(input.handle))) throw new CartError("input")
  if ((input.action === "remove" || input.action === "update") && !validId(input.lineId)) throw new CartError("input")
  return input as CartMutation
}
export function cartErrorMessage(error: unknown): string {
  const kind = error instanceof CartError ? error.kind : "backend"
  const messages: Record<CartIssue, string> = {
    configuration: "Cart setup is unavailable. Please contact the store operator.",
    backend: "We could not load your cart. Please try again shortly. Your cart has not been reset.",
    uncertain: "We could not confirm the change. It may have been saved. Open or refresh your cart to check before trying again.",
    input: "Please choose a valid item and a whole quantity from 1 to 99.",
    stock: "The requested quantity is not available. Please check the item availability or reduce the quantity.",
    rejected: "The store could not accept this change. Availability or pricing may have changed. Check your cart before trying again.",
    missing: "This saved cart is no longer available. Reset the saved cart to start again. No items will be copied.",
    completed: "This saved cart has already been completed. Reset the saved cart to start a new one. Existing orders will not be changed.",
    mismatch: "Your saved cart belongs to a different shopping country, region, currency, or sales channel. It has not been changed. You can reset it to start again; existing items will not be copied.",
    line: "This item is no longer in your current cart. Refresh the cart before trying again.",
    variant: "This product option is no longer available to purchase. Please choose an available, priced variant.",
    origin: "This request could not be verified. Reload the store and try again.",
  }
  return messages[kind]
}
