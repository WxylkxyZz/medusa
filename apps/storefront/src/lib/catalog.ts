// Public, serializable view models only. No environment access in this module.
export type Price = { amount: number; currencyCode: string }
export type Variant = {
  id: string
  title: string
  sku: string | null
  options: { optionId: string; value: string }[]
  price: Price | null
  manageInventory: boolean | null
  allowBackorder: boolean | null
  inventoryQuantity: number | null
}
export type ProductOption = { id: string; title: string; values: string[] }
export type Product = {
  id: string
  handle: string
  title: string
  subtitle: string | null
  description: string | null
  images: string[]
  options: ProductOption[]
  variants: Variant[]
  collection: string | null
  material: string | null
}

export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function productHref(handle: string): string {
  // Dot segments are normalized by browsers even when percent-encoded.
  return handle === "." || handle === ".." ? "/store" : `/store/${encodeURIComponent(handle)}`
}

export function formatPrice(price: Price | null): string {
  if (!price || !Number.isFinite(price.amount) || price.amount < 0 || !/^[a-z]{3}$/i.test(price.currencyCode)) {
    return "Price unavailable"
  }
  try {
    // Medusa v2 amounts are major currency units: 19.99 means $19.99, not $0.20.
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: price.currencyCode.toUpperCase(),
    }).format(price.amount)
  } catch {
    return "Price unavailable"
  }
}

export function productPrice(product: Product): string {
  const prices = product.variants.flatMap((variant) => variant.price ? [variant.price] : [])
  if (!prices.length) return "Price unavailable"
  const lowest = prices.reduce((a, b) => a.amount <= b.amount ? a : b)
  const varies = prices.some((price) => price.amount !== lowest.amount) || prices.length < product.variants.length
  return `${varies ? "From " : ""}${formatPrice(lowest)}`
}

export function initialSelection(options: ProductOption[], variants: Variant[]): Record<string, string> {
  // A single variant is unambiguous. Multiple variants require explicit choices.
  if (variants.length !== 1) return {}
  return Object.fromEntries(options.flatMap((option) => {
    const value = variants[0].options.find((entry) => entry.optionId === option.id)?.value
    return value === undefined ? [] : [[option.id, value]]
  }))
}

export function matchingVariants(options: ProductOption[], variants: Variant[], selection: Record<string, string>): Variant[] {
  if (options.some((option) => !selection[option.id])) return []
  return variants.filter((variant) => options.every((option) =>
    variant.options.some((value) => value.optionId === option.id && value.value === selection[option.id])
  ))
}

export function availability(variant: Variant | undefined): string {
  if (!variant) return "Select a variant to see availability"
  if (variant.manageInventory === false) return "In stock"
  if (variant.manageInventory !== true) return "Availability unavailable"
  const quantity = variant.inventoryQuantity
  if (quantity !== null && Number.isFinite(quantity) && quantity >= 1) return "In stock"
  if (variant.allowBackorder === true) return "Available on backorder"
  if (quantity === null || !Number.isFinite(quantity)) return "Availability unavailable"
  return "Out of stock"
}

export function canPurchase(variant: Variant | undefined, quantity = 1): boolean {
  if (!variant?.price || !Number.isFinite(variant.price.amount) || variant.price.amount < 0 ||
    !/^[a-z]{3}$/i.test(variant.price.currencyCode) || !Number.isSafeInteger(quantity) || quantity < 1) return false
  if (variant.manageInventory === false) return true
  if (variant.manageInventory !== true) return false
  return variant.allowBackorder === true || (variant.inventoryQuantity !== null && Number.isFinite(variant.inventoryQuantity) && variant.inventoryQuantity >= quantity)
}

export const PAGE_SIZE = 12
export const MAX_PAGE = 10000
export function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page <= MAX_PAGE ? page : 1
}
