import type { Price } from "./catalog.ts"
import { validId } from "./cart.ts"
import type { Cart, CartLine } from "./cart.ts"

export const ADDRESS_LIMITS = {
  firstName: 100,
  lastName: 100,
  address1: 200,
  address2: 200,
  city: 100,
  province: 100,
  postalCode: 32,
  countryCode: 2,
  phone: 40,
  company: 100,
} as const

type AddressKey = keyof typeof ADDRESS_LIMITS
export type AddressInput = {
  firstName: string
  lastName: string
  address1: string
  address2?: string
  city: string
  province?: string
  postalCode: string
  countryCode: string
  phone?: string
  company?: string
}
export type CheckoutAddress = {
  firstName: string | null
  lastName: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  countryCode: string | null
  phone: string | null
  company: string | null
}
export type NormalizedAddress = {
  first_name: string
  last_name: string
  address_1: string
  city: string
  postal_code: string
  country_code: string
  address_2?: string
  province?: string
  phone?: string
  company?: string
}

export type CheckoutMutation =
  | { action: "update-address"; address: AddressInput; useSameBilling: boolean }
  | { action: "list-shipping-options" }
  | { action: "select-shipping"; optionId: string }

export type ShippingOption = {
  id: string
  name: string
  priceType: "flat" | "calculated"
  amount: Price
  currencyCode: string
  isTaxInclusive: boolean
  insufficientInventory: boolean
}
export type ShippingMethod = {
  optionId: string
  name: string | null
  amount: Price
  isTaxInclusive: boolean
}
export type CheckoutCart = Cart & {
  shippingTotal: Price | null
  shippingAddress: CheckoutAddress | null
  shippingMethods: ShippingMethod[]
}
export type ShippingState = "no-cart" | "address-required" | "available" | "none" | "configuration" | "backend"
export type CheckoutState = {
  cart: CheckoutCart | null
  shippingOptions: ShippingOption[]
  shippingState: ShippingState
  issue?: "missing" | "completed" | "mismatch"
}

export type CheckoutIssue =
  | "configuration"
  | "backend"
  | "uncertain"
  | "input"
  | "origin"
  | "missing"
  | "completed"
  | "mismatch"
  | "address"
  | "option"
  | "shipping_rejected"
export class CheckoutError extends Error {
  kind: CheckoutIssue
  constructor(kind: CheckoutIssue) {
    super(kind)
    this.name = "CheckoutError"
    this.kind = kind
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function invalidResponse(): never { throw new CheckoutError("backend") }
function invalidInput(): never { throw new CheckoutError("input") }
function invalidAddress(): never { throw new CheckoutError("address") }
function hasControlCharacters(value: string): boolean { return /[\u0000-\u001f\u007f]/.test(value) }

function normalizeText(value: unknown, key: AddressKey, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== "string" || value.length > ADDRESS_LIMITS[key] || hasControlCharacters(value)) invalidAddress()
  const normalized = value.trim().replace(/\s+/g, " ")
  if (required && !normalized) invalidAddress()
  return normalized || undefined
}

/**
 * Convert the browser's small camel-case address object to the exact Medusa
 * address payload. Optional blank fields are omitted rather than sent as
 * arbitrary nulls or empty provider data.
 */
export function normalizeCheckoutAddress(value: unknown, expectedCountry: string): NormalizedAddress {
  if (!record(value)) invalidInput()
  const allowed = new Set<string>([
    "firstName", "lastName", "address1", "address2", "city", "province", "postalCode", "countryCode", "phone", "company",
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) invalidInput()
  const firstName = normalizeText(value.firstName, "firstName", true)
  const lastName = normalizeText(value.lastName, "lastName", true)
  const address1 = normalizeText(value.address1, "address1", true)
  const city = normalizeText(value.city, "city", true)
  const postalCode = normalizeText(value.postalCode, "postalCode", true)
  const countryCode = normalizeText(value.countryCode, "countryCode", true)?.toLowerCase()
  if (!firstName || !lastName || !address1 || !city || !postalCode || !countryCode ||
      !/^[a-z]{2}$/.test(countryCode)) invalidAddress()
  const expected = expectedCountry.trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(expected) || countryCode !== expected) throw new CheckoutError("mismatch")
  const result: NormalizedAddress = { first_name: firstName, last_name: lastName, address_1: address1, city, postal_code: postalCode, country_code: countryCode }
  const optional: Array<[AddressKey, keyof NormalizedAddress]> = [
    ["address2", "address_2"], ["province", "province"], ["phone", "phone"], ["company", "company"],
  ]
  for (const [inputKey, outputKey] of optional) {
    const normalized = normalizeText(value[inputKey], inputKey, false)
    if (normalized) result[outputKey] = normalized
  }
  return result
}

const ADDRESS_INPUT_KEYS = new Set<keyof AddressInput>([
  "firstName", "lastName", "address1", "address2", "city", "province", "postalCode", "countryCode", "phone", "company",
])

function validateAddressInputShape(value: unknown): AddressInput {
  if (!record(value)) invalidInput()
  if (Object.keys(value).some((key) => !ADDRESS_INPUT_KEYS.has(key as keyof AddressInput))) invalidInput()
  for (const key of ["firstName", "lastName", "address1", "city", "postalCode", "countryCode"] as const) {
    normalizeText(value[key], key, true)
  }
  const countryCode = normalizeText(value.countryCode, "countryCode", true)
  if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) invalidAddress()
  for (const key of ["address2", "province", "phone", "company"] as const) {
    normalizeText(value[key], key, false)
  }
  // Copy the allowlisted scalar fields into this module's realm. Besides
  // preventing a caller-owned object from being retained, this keeps the
  // validated value plain when the route is exercised across a request realm.
  return Object.fromEntries(Object.entries(value)) as AddressInput
}

export function validateCheckoutMutation(value: unknown): CheckoutMutation {
  if (!record(value) || typeof value.action !== "string") invalidInput()
  const input = value as Record<string, unknown>
  if (input.action === "list-shipping-options") {
    if (Object.keys(input).length !== 1) invalidInput()
    return { action: input.action }
  }
  if (input.action === "select-shipping") {
    if (Object.keys(input).length !== 2 || !validId(input.optionId)) invalidInput()
    return { action: input.action, optionId: input.optionId }
  }
  if (input.action === "update-address") {
    if (Object.keys(input).length !== 3 || typeof input.useSameBilling !== "boolean") invalidInput()
    // Reject unknown address keys at the request boundary. Region-dependent
    // country validation and required-field validation happen after the
    // server loads the cart's configured region.
    const address = validateAddressInputShape(input.address)
    return { action: input.action, address, useSameBilling: input.useSameBilling }
  }
  invalidInput()
}

function projectRawText(value: unknown, key: AddressKey): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || value.length > ADDRESS_LIMITS[key] || hasControlCharacters(value)) invalidResponse()
  return value
}

/** Project an address returned by Medusa without its internal id or metadata. */
export function projectCheckoutAddress(value: unknown): CheckoutAddress | null {
  if (value === undefined || value === null) return null
  if (!record(value)) invalidResponse()
  const countryCode = projectRawText(value.country_code, "countryCode")
  if (countryCode !== null && !/^[a-z]{2}$/i.test(countryCode)) invalidResponse()
  return {
    firstName: projectRawText(value.first_name, "firstName"),
    lastName: projectRawText(value.last_name, "lastName"),
    address1: projectRawText(value.address_1, "address1"),
    address2: projectRawText(value.address_2, "address2"),
    city: projectRawText(value.city, "city"),
    province: projectRawText(value.province, "province"),
    postalCode: projectRawText(value.postal_code, "postalCode"),
    countryCode: countryCode?.toLowerCase() ?? null,
    phone: projectRawText(value.phone, "phone"),
    company: projectRawText(value.company, "company"),
  }
}

export function addressIsComplete(address: CheckoutAddress | null, expectedCountry: string): boolean {
  return !!address && [address.firstName, address.lastName, address.address1, address.city, address.postalCode].every((value) => !!value?.trim()) &&
    address.countryCode === expectedCountry.trim().toLowerCase()
}

function projectAmount(value: unknown, currencyCode: string): Price | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !/^[a-z]{3}$/.test(currencyCode)) invalidResponse()
  return { amount: value, currencyCode }
}

export function projectShippingOption(value: unknown, currencyCode: string): ShippingOption {
  if (!record(value) || !validId(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 256 || hasControlCharacters(value.name) ||
      !["flat", "calculated"].includes(String(value.price_type))) invalidResponse()
  const calculatedPrice = value.calculated_price
  if (!record(calculatedPrice) || typeof calculatedPrice.currency_code !== "string" || calculatedPrice.currency_code.toLowerCase() !== currencyCode ||
      typeof calculatedPrice.calculated_amount !== "number" || !Number.isFinite(calculatedPrice.calculated_amount) ||
      (calculatedPrice.is_calculated_price_tax_inclusive !== undefined && typeof calculatedPrice.is_calculated_price_tax_inclusive !== "boolean")) invalidResponse()
  const amount = projectAmount(value.amount, currencyCode)
  if (!amount || amount.amount !== calculatedPrice.calculated_amount || typeof value.is_tax_inclusive !== "boolean" ||
      (calculatedPrice.is_calculated_price_tax_inclusive !== undefined && value.is_tax_inclusive !== calculatedPrice.is_calculated_price_tax_inclusive) ||
      typeof value.insufficient_inventory !== "boolean") invalidResponse()
  return {
    id: value.id,
    name: value.name,
    priceType: value.price_type as ShippingOption["priceType"],
    amount,
    currencyCode: amount.currencyCode,
    isTaxInclusive: value.is_tax_inclusive,
    insufficientInventory: value.insufficient_inventory,
  }
}

export function projectShippingOptions(value: unknown, currencyCode: string): ShippingOption[] {
  if (!Array.isArray(value) || !/^[a-z]{3}$/.test(currencyCode)) invalidResponse()
  const ids = new Set<string>()
  return value.map((entry) => {
    const option = projectShippingOption(entry, currencyCode)
    if (ids.has(option.id)) invalidResponse()
    ids.add(option.id)
    return option
  })
}

export function projectShippingMethod(value: unknown, currencyCode: string): ShippingMethod {
  if (!record(value) || !validId(value.shipping_option_id)) invalidResponse()
  const amount = projectAmount(value.amount, currencyCode)
  if (!amount || typeof value.is_tax_inclusive !== "boolean") invalidResponse()
  if (value.name !== undefined && value.name !== null && (typeof value.name !== "string" || value.name.length > 256 || hasControlCharacters(value.name))) invalidResponse()
  return { optionId: value.shipping_option_id, name: typeof value.name === "string" ? value.name : null, amount, isTaxInclusive: value.is_tax_inclusive }
}

export function checkoutCartProjection(value: {
  cart: Cart & { shippingTotal: Price | null }
  shippingAddress: CheckoutAddress | null
  shippingMethods: ShippingMethod[]
}): CheckoutCart {
  // Rebuild the object explicitly so a future internal cart field cannot cross
  // the server/client boundary by accident.
  const lines: CartLine[] = value.cart.lines.map((line) => ({ ...line }))
  return {
    currencyCode: value.cart.currencyCode,
    lines,
    subtotal: value.cart.subtotal,
    itemSubtotal: value.cart.itemSubtotal,
    total: value.cart.total,
    taxTotal: value.cart.taxTotal,
    discountTotal: value.cart.discountTotal,
    shippingTotal: value.cart.shippingTotal ?? null,
    shippingAddress: value.shippingAddress,
    shippingMethods: value.shippingMethods.map((method) => ({ ...method, amount: { ...method.amount } })),
  }
}

export function checkoutErrorMessage(error: unknown): string {
  const kind = error instanceof CheckoutError ? error.kind : "backend"
  const messages: Record<CheckoutIssue, string> = {
    configuration: "Checkout shipping is not configured. Please contact the store operator.",
    backend: "We could not refresh checkout. Please try again shortly.",
    uncertain: "We could not confirm the change. It may have been saved. Refresh checkout before trying again.",
    input: "Checkout received invalid input. Reload the page and try again.",
    origin: "This request could not be verified. Reload the store and try again.",
    missing: "This saved cart is no longer available. Reset the saved cart to start again. No items will be copied.",
    completed: "This saved cart has already been completed. Reset the saved cart to start a new one. Existing orders will not be changed.",
    mismatch: "Your saved cart belongs to a different shopping country, region, currency, or sales channel. It has not been changed. Reset it to start again; existing items will not be copied.",
    address: "Enter a complete shipping address with a first name, last name, address, city, postal code, and country.",
    option: "That shipping option is not available for this cart. Refresh checkout and choose a listed option.",
    shipping_rejected: "The store could not accept that shipping method. Availability or pricing may have changed; refresh checkout before trying again.",
  }
  return messages[kind]
}

export function checkoutErrorStatus(error: CheckoutError): number {
  if (error.kind === "origin") return 403
  if (["input", "address"].includes(error.kind)) return 400
  if (["configuration", "backend", "uncertain"].includes(error.kind)) return 503
  return 409
}

export type CheckoutCartReadIssue = Extract<CheckoutError["kind"], "missing" | "completed" | "mismatch">
