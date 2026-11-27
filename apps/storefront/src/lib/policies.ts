// Region policy model adapted from medusajs/dtc-starter (MIT).
//
// Policy values are read from region metadata and never guessed. The only
// non-metadata values are the operator-approved shipping facts for USD orders
// (flat 5.00, standard service, 5-7 day transit, tax not included). Return
// terms have no approved values, so returns stay "not published" until the
// region metadata supplies them.
//
// Recognized region metadata keys:
//   shipping_rate (number, major currency units, region currency)
//   shipping_service (string, e.g. "standard")
//   transit_days_min, transit_days_max (integer days)
//   tax_inclusive (boolean)
//   return_window_days (integer days, >= 1)
//   free_returns (boolean, optional)
//   return_method ("mail", optional)
import type { Price } from "./catalog.ts"

export const POLICY_METADATA_KEYS = [
  "shipping_rate",
  "shipping_service",
  "transit_days_min",
  "transit_days_max",
  "tax_inclusive",
  "return_window_days",
  "free_returns",
  "return_method",
] as const

export type PolicyMetadataKey = (typeof POLICY_METADATA_KEYS)[number]
export type PolicyMetadataValue = string | number | boolean
export type PolicyMetadata = Partial<Record<PolicyMetadataKey, PolicyMetadataValue>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Keep only allowlisted, JSON-scalar metadata. Arbitrary region metadata never
// reaches pages or clients through this projection.
export function projectPolicyMetadata(value: unknown): PolicyMetadata | null {
  if (!isRecord(value)) return null
  const projected: PolicyMetadata = {}
  for (const key of POLICY_METADATA_KEYS) {
    const entry = value[key]
    if (typeof entry === "string" || typeof entry === "boolean") projected[key] = entry
    else if (typeof entry === "number" && Number.isFinite(entry)) projected[key] = entry
  }
  return Object.keys(projected).length ? projected : null
}

function amount(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000_000 ? parsed : null
}

function wholeDays(value: unknown, minimum: number): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return null
}

export type ShippingPolicy = {
  rate: Price
  service: string
  transitDays: { min: number; max: number }
  taxInclusive: boolean
}
export type ShippingState =
  | { status: "published"; policy: ShippingPolicy }
  | { status: "not-published"; reason: "no-policy" }
export type ReturnsPolicy = {
  windowDays: number
  freeReturns: boolean | null
  method: "mail" | null
}
export type ReturnsState =
  | { status: "published"; policy: ReturnsPolicy }
  | { status: "not-published"; reason: "no-policy" }

// Operator-approved policy for USD orders. Used only when a USD region has no
// shipping policy metadata at all; malformed metadata is never overridden.
const APPROVED_USD_SHIPPING = {
  rate: 5,
  service: "standard",
  transitDays: { min: 5, max: 7 },
  taxInclusive: false,
} as const

const SHIPPING_KEYS: PolicyMetadataKey[] = [
  "shipping_rate", "shipping_service", "transit_days_min", "transit_days_max", "tax_inclusive",
]

function shippingFromMetadata(metadata: PolicyMetadata | null | undefined, currencyCode: string): ShippingPolicy | null {
  if (!metadata) return null
  const rate = amount(metadata.shipping_rate)
  const service = typeof metadata.shipping_service === "string" ? metadata.shipping_service.trim() : ""
  const min = wholeDays(metadata.transit_days_min, 0)
  const max = wholeDays(metadata.transit_days_max, 0)
  const taxInclusive = booleanOrNull(metadata.tax_inclusive)
  if (rate === null || !service || min === null || max === null || max < min || taxInclusive === null) return null
  return { rate: { amount: rate, currencyCode }, service, transitDays: { min, max }, taxInclusive }
}

export function shippingPolicyState(
  metadata: PolicyMetadata | null | undefined,
  currencyCode: string
): ShippingState {
  const currency = typeof currencyCode === "string" ? currencyCode.toLowerCase() : ""
  if (!/^[a-z]{3}$/.test(currency)) return { status: "not-published", reason: "no-policy" }
  const declared = metadata && SHIPPING_KEYS.some((key) => metadata[key] !== undefined)
  if (declared) {
    const policy = shippingFromMetadata(metadata, currency)
    // Invalid operator metadata is a publication failure, not a default.
    return policy ? { status: "published", policy } : { status: "not-published", reason: "no-policy" }
  }
  if (currency === "usd") {
    return {
      status: "published",
      policy: {
        rate: { amount: APPROVED_USD_SHIPPING.rate, currencyCode: currency },
        service: APPROVED_USD_SHIPPING.service,
        transitDays: { ...APPROVED_USD_SHIPPING.transitDays },
        taxInclusive: APPROVED_USD_SHIPPING.taxInclusive,
      },
    }
  }
  return { status: "not-published", reason: "no-policy" }
}

export function returnsPolicyState(metadata: PolicyMetadata | null | undefined): ReturnsState {
  const windowDays = wholeDays(metadata?.return_window_days, 1)
  if (windowDays === null) return { status: "not-published", reason: "no-policy" }
  const freeReturns = booleanOrNull(metadata?.free_returns)
  const method = metadata?.return_method === "mail" ? "mail" : null
  return { status: "published", policy: { windowDays, freeReturns, method } }
}

export function formatDayRange({ min, max }: { min: number; max: number }): string {
  if (min === max) return `${min} ${min === 1 ? "day" : "days"}`
  return `${min}-${max} days`
}
