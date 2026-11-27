import {
  findFulfillmentSet,
  hasSalesChannelFulfillmentSet,
} from "../bootstrap-local"
import {
  LOCAL_SHIPPING_FIXTURE,
  buildFixtureShippingOptionInput,
  isFixtureShippingOption,
  shippingOptionProblems,
} from "../shipping-fixture"

describe("local shipping fixture", () => {
  const serviceZoneId = "serzo_us"
  const shippingProfileId = "sp_test_product"

  it("resolves a persisted fulfillment set after a no-result workflow", () => {
    const persisted = findFulfillmentSet(
      [
        { id: "fulset_other", name: "Other", type: "shipping" },
        {
          id: "fulset_local",
          name: LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
          type: LOCAL_SHIPPING_FIXTURE.fulfillmentSetType,
        },
      ],
      LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
      LOCAL_SHIPPING_FIXTURE.fulfillmentSetType
    )

    expect(persisted).toEqual({
      id: "fulset_local",
      name: LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
      type: LOCAL_SHIPPING_FIXTURE.fulfillmentSetType,
    })
  })

  it("verifies the sales-channel to location to fulfillment-set path", () => {
    const channel = {
      stock_locations: [
        { id: "sloc_other", fulfillment_sets: [{ id: "fulset_local" }] },
        { id: "sloc_local", fulfillment_sets: [{ id: "fulset_local" }] },
      ],
    }

    expect(
      hasSalesChannelFulfillmentSet(channel, "sloc_local", "fulset_local")
    ).toBe(true)
    expect(
      hasSalesChannelFulfillmentSet(channel, "sloc_local", "fulset_other")
    ).toBe(false)
    expect(
      hasSalesChannelFulfillmentSet(channel, "sloc_missing", "fulset_local")
    ).toBe(false)
  })

  it("uses the user-approved flat USD 5.00 standard option values", () => {
    expect(LOCAL_SHIPPING_FIXTURE.amount).toBe(5)
    expect(LOCAL_SHIPPING_FIXTURE.currencyCode).toBe("usd")
    expect(LOCAL_SHIPPING_FIXTURE.providerId).toBe("manual_manual")
    expect(LOCAL_SHIPPING_FIXTURE.shippingOptionTypeDescription).toBe(
      "5-7 day transit"
    )
  })

  it("builds the create payload with a flat price in major units", () => {
    const input = buildFixtureShippingOptionInput(
      serviceZoneId,
      shippingProfileId
    )

    expect(input).toEqual({
      name: "Standard Shipping",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfileId,
      provider_id: "manual_manual",
      type: {
        label: "Standard",
        code: "standard",
        description: "5-7 day transit",
      },
      price_type: "flat",
      prices: [{ currency_code: "usd", amount: 5 }],
    })
  })

  it("matches an option only on the stable fixture attributes", () => {
    const matching = {
      name: "Standard Shipping",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfileId,
      provider_id: "manual_manual",
      price_type: "flat",
    }

    expect(isFixtureShippingOption(matching, serviceZoneId, shippingProfileId)).toBe(true)
    expect(
      isFixtureShippingOption(
        { ...matching, service_zone_id: "serzo_other" },
        serviceZoneId,
        shippingProfileId
      )
    ).toBe(false)
    expect(
      isFixtureShippingOption(
        { ...matching, shipping_profile_id: "sp_other" },
        serviceZoneId,
        shippingProfileId
      )
    ).toBe(false)
    expect(
      isFixtureShippingOption(
        { ...matching, provider_id: "other_provider" },
        serviceZoneId,
        shippingProfileId
      )
    ).toBe(false)
    expect(
      isFixtureShippingOption(
        { ...matching, price_type: "calculated" },
        serviceZoneId,
        shippingProfileId
      )
    ).toBe(false)
  })

  it("reports missing option, description, and price", () => {
    expect(shippingOptionProblems(undefined, serviceZoneId, shippingProfileId)).toEqual([
      "the Standard Shipping option could not be resolved",
    ])

    const problems = shippingOptionProblems(
      {
        name: "Standard Shipping",
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfileId,
        provider_id: "manual_manual",
        price_type: "flat",
        type: { description: undefined },
        prices: [{ currency_code: "usd", amount: 4 }],
      },
      serviceZoneId,
      shippingProfileId
    )

    expect(problems).toEqual([
      "the Standard Shipping option type is missing the 5-7 day transit description",
      "the Standard Shipping option is missing the flat USD 5.00 price",
    ])
  })

  it("accepts a fully resolved option", () => {
    const problems = shippingOptionProblems(
      {
        name: "Standard Shipping",
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfileId,
        provider_id: "manual_manual",
        price_type: "flat",
        type: { description: "5-7 day transit" },
        prices: [{ currency_code: "usd", amount: 5 }],
      },
      serviceZoneId,
      shippingProfileId
    )

    expect(problems).toEqual([])
  })
})
