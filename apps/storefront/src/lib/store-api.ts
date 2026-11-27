import type { Store } from "@medusajs/js-sdk"
import { createMedusaRequest, StoreRequestError } from "./medusa-http.ts"
import { PAGE_SIZE, MAX_PAGE, safeImageUrl } from "./catalog.ts"
import type { Product, Variant } from "./catalog.ts"
import { projectPolicyMetadata } from "./policies.ts"
import type { PolicyMetadata } from "./policies.ts"

type StoreProduct = Awaited<ReturnType<Store["product"]["list"]>>["products"][number]
type StoreRegion = Awaited<ReturnType<Store["region"]["list"]>>["regions"][number]
export type Region = {
  id: string
  name: string
  currencyCode: string
  countryCode: string
  // Allowlisted policy keys only, and only when the region declares any.
  // Arbitrary region metadata never leaves the server.
  metadata?: PolicyMetadata
}
export type StoreEnvironment = {
  MEDUSA_BACKEND_URL_INTERNAL?: string
  MEDUSA_SALES_CHANNEL_ID?: string
  NEXT_PUBLIC_MEDUSA_BACKEND_URL?: string
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY?: string
  NEXT_PUBLIC_DEFAULT_REGION?: string
}
export type CatalogErrorKind = "configuration" | "region" | "backend"
export class CatalogError extends Error {
  kind: CatalogErrorKind
  constructor(kind: CatalogErrorKind) {
    super(kind)
    this.name = "CatalogError"
    this.kind = kind
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
function invalidResponse(): never { throw new CatalogError("backend") }

// Runtime projection is an allowlist: no arbitrary metadata or provider fields reach clients.
export function toProduct(raw: StoreProduct, currency: string): Product {
  if (!record(raw) || typeof raw.id !== "string" || typeof raw.title !== "string" ||
      typeof raw.handle !== "string" || !raw.handle || raw.handle === "." || raw.handle === ".." ||
      (raw.variants != null && !Array.isArray(raw.variants)) ||
      (raw.options != null && !Array.isArray(raw.options)) ||
      (raw.images != null && !Array.isArray(raw.images))) invalidResponse()
  const variants: Variant[] = (raw.variants ?? []).map((variant) => {
    if (!record(variant) || typeof variant.id !== "string" ||
        (variant.options != null && !Array.isArray(variant.options))) invalidResponse()
    const calculated = variant.calculated_price
    const validPrice = record(calculated) && typeof calculated.calculated_amount === "number" &&
      Number.isFinite(calculated.calculated_amount) && calculated.calculated_amount >= 0 &&
      typeof calculated.currency_code === "string" && calculated.currency_code.toLowerCase() === currency
    return {
      id: variant.id,
      title: text(variant.title) || "Default variant",
      sku: text(variant.sku),
      options: (variant.options ?? []).map((value) => {
        if (!record(value) || typeof value.option_id !== "string" || typeof value.value !== "string") invalidResponse()
        return { optionId: value.option_id, value: value.value }
      }),
      price: validPrice ? { amount: calculated!.calculated_amount!, currencyCode: currency } : null,
      manageInventory: typeof variant.manage_inventory === "boolean" ? variant.manage_inventory : null,
      allowBackorder: typeof variant.allow_backorder === "boolean" ? variant.allow_backorder : null,
      inventoryQuantity: typeof variant.inventory_quantity === "number" && Number.isFinite(variant.inventory_quantity)
        ? variant.inventory_quantity : null,
    }
  })
  const options = (raw.options ?? []).map((option) => {
    if (!record(option) || typeof option.id !== "string" || typeof option.title !== "string" ||
        (option.values != null && !Array.isArray(option.values))) invalidResponse()
    const declared = (option.values ?? []).flatMap((entry) => record(entry) && typeof entry.value === "string" ? [entry.value] : [])
    const actual = variants.flatMap((variant) => variant.options.filter((value) => value.optionId === option.id).map((value) => value.value))
    return { id: option.id, title: option.title, values: [...new Set([...declared, ...actual])] }
  })
  const images = [raw.thumbnail, ...(raw.images ?? []).map((image) => record(image) ? image.url : null)]
    .map(safeImageUrl).filter((url): url is string => url !== null)
  return {
    id: raw.id, handle: raw.handle, title: raw.title,
    subtitle: text(raw.subtitle), description: text(raw.description),
    images: [...new Set(images)], options, variants,
    collection: record(raw.collection) ? text(raw.collection.title) : null,
    material: text(raw.material),
  }
}

export function createStoreApi(env: StoreEnvironment, fetcher: typeof fetch = fetch) {
  const countryCode = env.NEXT_PUBLIC_DEFAULT_REGION?.trim().toLowerCase()
  if (!countryCode || !/^[a-z]{2}$/.test(countryCode)) throw new CatalogError("configuration")
  let request: ReturnType<typeof createMedusaRequest>
  try { request = createMedusaRequest(env, fetcher) } catch { throw new CatalogError("configuration") }

  async function get(path: string, params: URLSearchParams): Promise<Record<string, unknown>> {
    try { return await request(path, params) } catch (error) {
      throw new CatalogError(error instanceof StoreRequestError && [401, 403].includes(error.status) ? "configuration" : "backend")
    }
  }

  async function resolveRegion(): Promise<Region> {
    const limit = 100
    for (let offset = 0; offset < 1000; offset += limit) {
      const data = await get("store/regions", new URLSearchParams({
        fields: "id,name,currency_code,metadata,*countries", limit: String(limit), offset: String(offset), order: "id",
      }))
      if (!Array.isArray(data.regions) || !Number.isSafeInteger(data.count) || Number(data.count) < 0) invalidResponse()
      for (const item of data.regions as StoreRegion[]) {
        if (!record(item) || typeof item.id !== "string" || typeof item.currency_code !== "string" ||
            !/^[a-z]{3}$/i.test(item.currency_code) || !Array.isArray(item.countries)) invalidResponse()
        if (item.countries.some((country) => record(country) && typeof country.iso_2 === "string" && country.iso_2.toLowerCase() === countryCode)) {
          const metadata = projectPolicyMetadata(item.metadata)
          return {
            id: item.id, name: text(item.name) || "Store region",
            currencyCode: item.currency_code.toLowerCase(), countryCode: countryCode!,
            ...(metadata ? { metadata } : {}),
          }
        }
      }
      if (offset + data.regions.length >= Number(data.count)) throw new CatalogError("region")
      if (data.regions.length !== limit) invalidResponse()
    }
    // Bound requests without incorrectly claiming a missing region in an incomplete response.
    throw new CatalogError("backend")
  }

  async function products(region: Region, page: number, handle?: string) {
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) throw new CatalogError("backend")
    const params = new URLSearchParams({
      region_id: region.id, country_code: region.countryCode,
      fields: "*variants.calculated_price,+variants.inventory_quantity,+status",
      limit: String(handle === undefined ? PAGE_SIZE : 1), offset: String(handle === undefined ? (page - 1) * PAGE_SIZE : 0),
      order: "id",
    })
    // Inventory calculation requires a single channel when the key authorizes several.
    const salesChannelId = env.MEDUSA_SALES_CHANNEL_ID?.trim()
    if (salesChannelId) params.set("sales_channel_id", salesChannelId)
    // Store API itself enforces published status and publishable-key sales-channel scope.
    // `status` is not an accepted Store API filter in Medusa 2.23.
    if (handle !== undefined) params.set("handle", handle)
    const data = await get("store/products", params)
    if (!Array.isArray(data.products) || !Number.isSafeInteger(data.count) || Number(data.count) < 0) invalidResponse()
    if (data.products.some((item) => !record(item) || item.status !== "published")) invalidResponse()
    return { products: (data.products as StoreProduct[]).map((item) => toProduct(item, region.currencyCode)), count: Number(data.count) }
  }

  // Sitemap discovery: published handles only, no prices or inventory fetch.
  async function handles(region: Region, page: number): Promise<{ handles: string[]; count: number }> {
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) throw new CatalogError("backend")
    const params = new URLSearchParams({
      region_id: region.id, country_code: region.countryCode,
      fields: "handle,+status",
      limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE), order: "id",
    })
    const salesChannelId = env.MEDUSA_SALES_CHANNEL_ID?.trim()
    if (salesChannelId) params.set("sales_channel_id", salesChannelId)
    const data = await get("store/products", params)
    if (!Array.isArray(data.products) || !Number.isSafeInteger(data.count) || Number(data.count) < 0) invalidResponse()
    const handles = (data.products as unknown[]).map((item) => {
      if (!record(item) || item.status !== "published" || typeof item.handle !== "string" ||
          !item.handle || item.handle === "." || item.handle === "..") invalidResponse()
      return item.handle
    })
    return { handles, count: Number(data.count) }
  }

  return {
    resolveRegion,
    listProducts: (region: Region, page = 1) => products(region, page),
    listProductHandles: (region: Region, page = 1) => handles(region, page),
    async getProduct(region: Region, handle: string): Promise<Product | null> {
      const result = await products(region, 1, handle)
      if (result.count === 0 && result.products.length === 0) return null
      if (result.products.length !== 1 || result.products[0].handle !== handle) invalidResponse()
      return result.products[0]
    },
  }
}

export function catalogErrorMessage(error: unknown): { title: string; message: string } {
  const kind = error instanceof CatalogError ? error.kind : "backend"
  if (kind === "configuration") return {
    title: "Store setup required",
    message: "The store connection or publishable API key is missing, invalid, or not authorized. Please contact the store operator.",
  }
  if (kind === "region") return {
    title: "Shopping region unavailable",
    message: "No store region includes the configured country. The store operator needs to complete region setup.",
  }
  return { title: "Catalog temporarily unavailable", message: "We could not load the catalog. Please try again shortly." }
}
