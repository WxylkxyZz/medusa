import { availability } from "./catalog.ts"
import type { Product, Variant } from "./catalog.ts"
import type { Region } from "./store-api.ts"

const SCHEMA_IN_STOCK = "https://schema.org/InStock"
const SCHEMA_OUT_OF_STOCK = "https://schema.org/OutOfStock"
const SCHEMA_BACK_ORDER = "https://schema.org/BackOrder"

/** Serializes JSON for a <script> element without allowing markup breakouts. */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" }[character]!)
  )
}

export function schemaAvailability(variant: Variant | undefined): string | null {
  const state = availability(variant)
  if (state === "In stock") return SCHEMA_IN_STOCK
  if (state === "Out of stock") return SCHEMA_OUT_OF_STOCK
  if (state === "Available on backorder") return SCHEMA_BACK_ORDER
  return null
}

/** Aggregate availability from real priced variant inventory, or null when unknown. */
export function aggregateAvailability(product: Product): string | null {
  const states = product.variants.filter((variant) => variant.price).map((variant) => schemaAvailability(variant))
  if (states.includes(SCHEMA_IN_STOCK)) return SCHEMA_IN_STOCK
  if (states.includes(SCHEMA_BACK_ORDER)) return SCHEMA_BACK_ORDER
  if (states.length && states.every((state) => state === SCHEMA_OUT_OF_STOCK)) return SCHEMA_OUT_OF_STOCK
  return null
}

export function lowestPrice(product: Product): { amount: number; currencyCode: string } | null {
  const prices = product.variants.flatMap((variant) => variant.price ? [variant.price] : [])
  if (!prices.length) return null
  return prices.reduce((a, b) => (a.amount <= b.amount ? a : b))
}

/** Price string with the currency's own minor-unit digits (JPY has none). */
export function priceString(amount: number, currencyCode: string): string | null {
  if (!Number.isFinite(amount) || amount < 0) return null
  try {
    const digits = new Intl.NumberFormat("en-US", {
      style: "currency", currency: currencyCode.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits
    return amount.toFixed(digits ?? 2)
  } catch {
    return null
  }
}

export function productStructuredData(product: Product, region: Region, url: string): Record<string, unknown> {
  const priced = product.variants.filter((variant) => variant.price)
  const offers = priced.flatMap((variant) => {
    const price = priceString(variant.price!.amount, region.currencyCode)
    if (!price) return []
    const available = schemaAvailability(variant)
    return [{
      "@type": "Offer",
      url,
      ...(variant.sku ? { sku: variant.sku } : {}),
      price,
      priceCurrency: region.currencyCode.toUpperCase(),
      ...(available ? { availability: available } : {}),
      itemCondition: "https://schema.org/NewCondition",
    }]
  })
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    ...(product.description ? { description: product.description } : {}),
    ...(product.images.length ? { image: product.images } : {}),
    url,
    // Without any real price there is no offer; availability alone is not a price.
    ...(offers.length === 1 ? { offers: offers[0] } : offers.length ? { offers } : {}),
  }
}

export type ProductMetaTag = { property: string; content: string }

/** Open Graph product price/availability tags, derived only from real values. */
export function productOpenGraphTags(product: Product, region: Region): ProductMetaTag[] {
  const tags: ProductMetaTag[] = []
  const lowest = lowestPrice(product)
  if (lowest) {
    const amount = priceString(lowest.amount, region.currencyCode)
    if (amount) {
      tags.push({ property: "product:price:amount", content: amount })
      tags.push({ property: "product:price:currency", content: region.currencyCode.toUpperCase() })
    }
  }
  const state = aggregateAvailability(product)
  // Open Graph product availability uses its own vocabulary, not schema.org URLs.
  if (state === SCHEMA_IN_STOCK) tags.push({ property: "product:availability", content: "in stock" })
  else if (state === SCHEMA_BACK_ORDER) tags.push({ property: "product:availability", content: "available for order" })
  else if (state === SCHEMA_OUT_OF_STOCK) tags.push({ property: "product:availability", content: "out of stock" })
  return tags
}

export type ProductPageMetadata = {
  title: string
  description?: string
  alternates?: { canonical: string }
  openGraph?: {
    title: string
    description?: string
    url?: string
    images?: { url: string }[]
  }
  other?: Record<string, string>
  robots?: { index: false; follow: false }
}

/** Metadata for a found product; missing/invalid products stay noindex. */
export function productPageMetadata(
  product: Product | null,
  region: Region | null,
  origin: string | null
): ProductPageMetadata {
  if (!product || !region) return { title: "Product | B2C Store", robots: { index: false, follow: false } }
  const description = (product.description || `View ${product.title} and available options.`).slice(0, 160)
  const url = origin ? `${origin}/store/${encodeURIComponent(product.handle)}` : undefined
  const other = Object.fromEntries(
    productOpenGraphTags(product, region).map((tag) => [tag.property, tag.content])
  )
  return {
    title: `${product.title} | B2C Store`,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    ...(Object.keys(other).length ? { other } : {}),
    openGraph: {
      title: `${product.title} | B2C Store`,
      description,
      ...(url ? { url } : {}),
      ...(product.images.length ? { images: product.images.map((image) => ({ url: image })) } : {}),
    },
  }
}
