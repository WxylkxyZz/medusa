/**
 * LOCAL-ONLY shipping fixture values and pure helpers.
 *
 * The values are user-approved local bootstrap values (flat USD 5.00 standard
 * shipping, 5-7 day transit, not tax-inclusive). They intentionally live in a
 * dependency-free module so the matching/building logic can be unit-tested
 * without a database.
 */

export const LOCAL_SHIPPING_FIXTURE = {
  fulfillmentSetName: "US Warehouse Shipping",
  fulfillmentSetType: "shipping",
  serviceZoneName: "United States",
  serviceZoneCountryCode: "us",
  shippingProfileName: "Local Test Product Shipping",
  shippingProfileType: "default",
  shippingOptionName: "Standard Shipping",
  shippingOptionTypeLabel: "Standard",
  shippingOptionTypeCode: "standard",
  shippingOptionTypeDescription: "5-7 day transit",
  providerId: "manual_manual",
  currencyCode: "usd",
  amount: 5,
} as const

export type ShippingOptionLike = {
  name?: unknown
  service_zone_id?: unknown
  shipping_profile_id?: unknown
  provider_id?: unknown
  price_type?: unknown
}

export type CreateShippingOptionInput = {
  name: string
  service_zone_id: string
  shipping_profile_id: string
  provider_id: string
  type: { label: string; code: string; description: string }
  price_type: "flat"
  prices: { currency_code: string; amount: number }[]
}

/**
 * Stable identity check for the fixture's flat-rate shipping option. Reruns
 * match on these attributes instead of a hardcoded shipping option id.
 */
export function isFixtureShippingOption(
  option: ShippingOptionLike,
  serviceZoneId: string,
  shippingProfileId: string
): boolean {
  return (
    option.name === LOCAL_SHIPPING_FIXTURE.shippingOptionName &&
    option.service_zone_id === serviceZoneId &&
    option.shipping_profile_id === shippingProfileId &&
    option.provider_id === LOCAL_SHIPPING_FIXTURE.providerId &&
    option.price_type === "flat"
  )
}

/** The exact payload passed to createShippingOptionsWorkflow on a first run. */
export function buildFixtureShippingOptionInput(
  serviceZoneId: string,
  shippingProfileId: string
): CreateShippingOptionInput {
  return {
    name: LOCAL_SHIPPING_FIXTURE.shippingOptionName,
    service_zone_id: serviceZoneId,
    shipping_profile_id: shippingProfileId,
    provider_id: LOCAL_SHIPPING_FIXTURE.providerId,
    type: {
      label: LOCAL_SHIPPING_FIXTURE.shippingOptionTypeLabel,
      code: LOCAL_SHIPPING_FIXTURE.shippingOptionTypeCode,
      description: LOCAL_SHIPPING_FIXTURE.shippingOptionTypeDescription,
    },
    price_type: "flat",
    prices: [
      {
        currency_code: LOCAL_SHIPPING_FIXTURE.currencyCode,
        amount: LOCAL_SHIPPING_FIXTURE.amount,
      },
    ],
  }
}

/**
 * Post-write verification. Returns a human-readable problem list; an empty
 * array means the persisted option matches the fixture associations.
 */
export function shippingOptionProblems(
  option:
    | (ShippingOptionLike & {
        type?: { description?: unknown } | null
        prices?: { currency_code?: unknown; amount?: unknown }[] | null
      })
    | undefined,
  serviceZoneId: string,
  shippingProfileId: string
): string[] {
  if (!option) {
    return ["the Standard Shipping option could not be resolved"]
  }
  const problems: string[] = []
  if (!isFixtureShippingOption(option, serviceZoneId, shippingProfileId)) {
    problems.push(
      "the Standard Shipping option is not associated with the expected zone, profile, provider and price type"
    )
  }
  if (option.type?.description !== LOCAL_SHIPPING_FIXTURE.shippingOptionTypeDescription) {
    problems.push("the Standard Shipping option type is missing the 5-7 day transit description")
  }
  const usdPrice = (option.prices ?? []).find(
    (price) => price.currency_code === LOCAL_SHIPPING_FIXTURE.currencyCode
  )
  if (!usdPrice || Number(usdPrice.amount) !== LOCAL_SHIPPING_FIXTURE.amount) {
    problems.push("the Standard Shipping option is missing the flat USD 5.00 price")
  }
  return problems
}
