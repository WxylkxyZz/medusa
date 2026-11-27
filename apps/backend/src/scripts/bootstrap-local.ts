import { writeFileSync } from "node:fs"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  batchLinksWorkflow,
  createApiKeysWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createLocationFulfillmentSetWorkflow,
  createPricePreferencesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updatePricePreferencesWorkflow,
  updateProductsWorkflow,
  updateShippingOptionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/core-flows"
import { Modules } from "@medusajs/framework/utils"
import {
  LOCAL_SHIPPING_FIXTURE,
  buildFixtureShippingOptionInput,
  isFixtureShippingOption,
  shippingOptionProblems,
} from "./shipping-fixture"

type Entity = Record<string, unknown>

type QueryService = {
  graph: (
    input: {
      entity: string
      fields: string[]
      filters: Record<string, unknown>
    },
    options?: { throwIfKeyNotFound?: boolean }
  ) => Promise<{ data?: unknown[] }>
}

function asEntity(value: unknown): Entity | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Entity)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function requiredId(entity: Entity | undefined, label: string): string {
  const id = asString(entity?.id)
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Local bootstrap could not resolve ${label}`
    )
  }
  return id
}

async function listEntities(
  container: MedusaContainer,
  entity: string,
  fields: string[]
): Promise<Entity[]> {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as unknown as QueryService
  const result = await query.graph(
    { entity, fields, filters: {} },
    { throwIfKeyNotFound: false }
  )
  return (result.data ?? []).map(asEntity).filter((item): item is Entity => !!item)
}

function findByName(entities: Entity[], names: string[]): Entity | undefined {
  return entities.find((entity) => names.includes(asString(entity.name) ?? ""))
}

export function findFulfillmentSet(
  entities: Entity[],
  name: string,
  type: string
): Entity | undefined {
  return entities.find(
    (entity) => asString(entity.name) === name && asString(entity.type) === type
  )
}

export function hasSalesChannelFulfillmentSet(
  salesChannel: Entity | undefined,
  locationId: string,
  fulfillmentSetId: string
): boolean {
  const locations = Array.isArray(salesChannel?.stock_locations)
    ? salesChannel.stock_locations
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  const location = locations.find((item) => asString(item.id) === locationId)
  const fulfillmentSets = Array.isArray(location?.fulfillment_sets)
    ? location.fulfillment_sets
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  return fulfillmentSets.some((item) => asString(item.id) === fulfillmentSetId)
}

async function runBootstrap({ container }: { container: MedusaContainer }) {
  const adminEmail = process.env.LOCAL_ADMIN_EMAIL || "admin@local.test"
  const publishableKeyPath =
    process.env.LOCAL_PUBLISHABLE_KEY_FILE || "/tmp/local-publishable-key"

  const users = await listEntities(container, "user", ["id", "email"])
  const admin = users.find((user) => asString(user.email) === adminEmail)
  const adminId = requiredId(admin, `local admin ${adminEmail}`)

  const regions = await listEntities(container, "region", [
    "id",
    "name",
    "currency_code",
    "countries.*",
  ])
  let region = findByName(regions, ["United States"])
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "United States",
            currency_code: "usd",
            countries: ["us"],
            automatic_taxes: false,
          },
        ],
      },
    })
    region = asEntity(result[0])
  }
  const regionId = requiredId(region, "United States region")
  if (!Array.isArray(region?.countries)) {
    region = (
      await listEntities(container, "region", ["id", "currency_code", "countries.*"])
    ).find((item) => asString(item.id) === regionId)
  }

  if (asString(region?.currency_code)?.toLowerCase() !== "usd") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The existing United States region is not configured for USD"
    )
  }
  const regionCountries = Array.isArray(region?.countries)
    ? region.countries
        .map(asEntity)
        .filter((country): country is Entity => !!country)
    : []
  if (
    !regionCountries.some(
      (country) => asString(country.iso_2)?.toLowerCase() === "us"
    )
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The United States region is not configured for country us"
    )
  }

  const salesChannels = await listEntities(container, "sales_channel", [
    "id",
    "name",
    "is_disabled",
  ])
  let salesChannel = findByName(salesChannels, [
    "Webshop",
    "Default Sales Channel",
  ])
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [{ name: "Webshop", is_disabled: false }],
      },
    })
    salesChannel = asEntity(result[0])
  }
  const salesChannelId = requiredId(salesChannel, "local sales channel")

  const locations = await listEntities(container, "stock_location", [
    "id",
    "name",
    "sales_channels.id",
  ])
  let location = findByName(locations, ["US Warehouse"])
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: "US Warehouse" }] },
    })
    location = asEntity(result[0])
  }
  const locationId = requiredId(location, "US Warehouse stock location")

  const loadLocationWithFulfillment = async (): Promise<Entity | undefined> =>
    (await listEntities(container, "stock_location", [
      "id",
      "fulfillment_sets.id",
      "fulfillment_sets.name",
      "fulfillment_sets.type",
      "fulfillment_providers.id",
    ])).find((item) => asString(item.id) === locationId)

  let locationWithFulfillment = await loadLocationWithFulfillment()
  const fulfillmentSets = Array.isArray(locationWithFulfillment?.fulfillment_sets)
    ? locationWithFulfillment.fulfillment_sets
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  let fulfillmentSet = findFulfillmentSet(
    fulfillmentSets,
    LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
    LOCAL_SHIPPING_FIXTURE.fulfillmentSetType
  )
  if (!fulfillmentSet) {
    // A prior partial run may have created the set but failed before linking it
    // to this location. Reuse that set instead of creating a duplicate.
    fulfillmentSet = findFulfillmentSet(
      await listEntities(container, "fulfillment_set", ["id", "name", "type"]),
      LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
      LOCAL_SHIPPING_FIXTURE.fulfillmentSetType
    )
    if (fulfillmentSet) {
      await batchLinksWorkflow(container).run({
        input: {
          create: [
            {
              [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
              [Modules.FULFILLMENT]: {
                fulfillment_set_id: requiredId(
                  fulfillmentSet,
                  "US Warehouse shipping fulfillment set"
                ),
              },
            },
          ],
        },
      })
    } else {
      // This workflow creates and associates the set internally but returns no
      // result in Medusa 2.23. Re-query by its stable identity after the write.
      await createLocationFulfillmentSetWorkflow(container).run({
        input: {
          location_id: locationId,
          fulfillment_set_data: {
            name: LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
            type: LOCAL_SHIPPING_FIXTURE.fulfillmentSetType,
          },
        },
      })
      fulfillmentSet = findFulfillmentSet(
        await listEntities(container, "fulfillment_set", ["id", "name", "type"]),
        LOCAL_SHIPPING_FIXTURE.fulfillmentSetName,
        LOCAL_SHIPPING_FIXTURE.fulfillmentSetType
      )
    }
  }

  // Always refresh the relation after either link path. Do not rely on the
  // pre-write graph result, which is stale after a workflow mutation.
  locationWithFulfillment = await loadLocationWithFulfillment()
  const linkedFulfillmentSet = Array.isArray(locationWithFulfillment?.fulfillment_sets)
    ? locationWithFulfillment.fulfillment_sets
        .map(asEntity)
        .filter((item): item is Entity => !!item)
        .find((item) => asString(item.id) === asString(fulfillmentSet?.id))
    : undefined
  if (!linkedFulfillmentSet) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Local bootstrap could not verify the US Warehouse shipping fulfillment set link"
    )
  }
  fulfillmentSet = linkedFulfillmentSet
  const fulfillmentSetId = requiredId(
    fulfillmentSet,
    "US Warehouse shipping fulfillment set"
  )

  const providerId = LOCAL_SHIPPING_FIXTURE.providerId
  const fulfillmentProviders = Array.isArray(locationWithFulfillment?.fulfillment_providers)
    ? locationWithFulfillment.fulfillment_providers
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  if (!fulfillmentProviders.some((provider) => asString(provider.id) === providerId)) {
    const providers = await listEntities(container, "fulfillment_provider", ["id"])
    if (!providers.some((provider) => asString(provider.id) === providerId)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `The built-in manual fulfillment provider ${providerId} is not registered`
      )
    }
    await batchLinksWorkflow(container).run({
      input: {
        create: [
          {
            [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
            [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
          },
        ],
      },
    })
    // Re-query the relation after linking; the earlier graph response cannot
    // prove that the stock-location/provider link was persisted.
    locationWithFulfillment = await loadLocationWithFulfillment()
    const linkedProviders = Array.isArray(
      locationWithFulfillment?.fulfillment_providers
    )
      ? locationWithFulfillment.fulfillment_providers
          .map(asEntity)
          .filter((item): item is Entity => !!item)
      : []
    if (!linkedProviders.some((provider) => asString(provider.id) === providerId)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Local bootstrap could not link the manual fulfillment provider ${providerId}`
      )
    }
  }

  const fulfillmentSetWithZones = (await listEntities(
    container,
    "fulfillment_set",
    ["id", "service_zones.id", "service_zones.name", "service_zones.geo_zones.*"]
  )).find((item) => asString(item.id) === fulfillmentSetId)
  const serviceZones = Array.isArray(fulfillmentSetWithZones?.service_zones)
    ? fulfillmentSetWithZones.service_zones
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  let serviceZone = serviceZones.find(
    (zone) => asString(zone.name) === LOCAL_SHIPPING_FIXTURE.serviceZoneName
  )
  if (!serviceZone) {
    const { result } = await createServiceZonesWorkflow(container).run({
      input: {
        data: [
          {
            name: LOCAL_SHIPPING_FIXTURE.serviceZoneName,
            fulfillment_set_id: fulfillmentSetId,
            geo_zones: [
              {
                type: "country",
                country_code: LOCAL_SHIPPING_FIXTURE.serviceZoneCountryCode,
              },
            ],
          },
        ],
      },
    })
    serviceZone = asEntity(result[0])
  }
  const serviceZoneId = requiredId(serviceZone, "United States shipping service zone")
  serviceZone =
    (await listEntities(container, "service_zone", ["id", "geo_zones.*"])).find(
      (item) => asString(item.id) === serviceZoneId
    ) ?? serviceZone
  const geoZones = Array.isArray(serviceZone?.geo_zones)
    ? serviceZone.geo_zones
        .map(asEntity)
        .filter((item): item is Entity => !!item)
    : []
  if (
    !geoZones.some(
      (geoZone) =>
        asString(geoZone.type) === "country" &&
        asString(geoZone.country_code)?.toLowerCase() ===
          LOCAL_SHIPPING_FIXTURE.serviceZoneCountryCode
    )
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The United States shipping service zone does not cover country us"
    )
  }

  const regionPreferences = await listEntities(container, "price_preference", [
    "id",
    "attribute",
    "value",
    "is_tax_inclusive",
  ])
  const regionPreference = regionPreferences.find(
    (preference) =>
      asString(preference.attribute) === "region_id" &&
      asString(preference.value) === regionId
  )
  if (regionPreference && regionPreference.is_tax_inclusive === true) {
    await updatePricePreferencesWorkflow(container).run({
      input: {
        selector: { id: [requiredId(regionPreference, "United States price preference")] },
        update: { is_tax_inclusive: false },
      },
    })
  }
  if (!regionPreference) {
    await createPricePreferencesWorkflow(container).run({
      input: [{ attribute: "region_id", value: regionId, is_tax_inclusive: false }],
    })
  }

  const linkedSalesChannels = Array.isArray(location?.sales_channels)
    ? location.sales_channels
        .map(asEntity)
        .filter((item): item is Entity => !!item)
        .map((item) => asString(item.id))
    : []
  if (!linkedSalesChannels.includes(salesChannelId)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: locationId, add: [salesChannelId] },
    })
  }
  const salesChannelWithFulfillment = (
    await listEntities(container, "sales_channel", [
      "id",
      "stock_locations.id",
      "stock_locations.fulfillment_sets.id",
    ])
  ).find((item) => asString(item.id) === salesChannelId)
  if (
    !hasSalesChannelFulfillmentSet(
      salesChannelWithFulfillment,
      locationId,
      fulfillmentSetId
    )
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Local bootstrap could not verify sales channel to stock location to fulfillment set"
    )
  }

  const stores = await listEntities(container, "store", [
    "id",
    "name",
    "supported_currencies.*",
    "default_region_id",
    "default_sales_channel_id",
    "default_location_id",
  ])
  let store: Entity | undefined = stores[0]
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: requiredId(store, "local store") },
        update: {
          supported_currencies: [
            { currency_code: "usd", is_default: true },
          ],
          default_region_id: regionId,
          default_sales_channel_id: salesChannelId,
          default_location_id: locationId,
        },
      },
    })
  } else {
    const { result } = await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "B2C Store",
            supported_currencies: [
              { currency_code: "usd", is_default: true },
            ],
            default_region_id: regionId,
            default_sales_channel_id: salesChannelId,
            default_location_id: locationId,
          },
        ],
      },
    })
    store = asEntity(result[0])
    requiredId(store, "B2C store")
  }

  const apiKeys = await listEntities(container, "api_key", [
    "id",
    "title",
    "type",
    "token",
    "sales_channels.id",
  ])
  let apiKey = apiKeys.find(
    (item) =>
      asString(item.title) === "Local Storefront" &&
      asString(item.type) === "publishable"
  )
  if (!apiKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Local Storefront",
            type: "publishable",
            created_by: adminId,
          },
        ],
      },
    })
    apiKey = asEntity(result[0])
  }
  const apiKeyId = requiredId(apiKey, "Local Storefront publishable API key")
  const apiKeyToken = asString(apiKey?.token)
  if (!apiKeyToken) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The existing Local Storefront key has no readable token; create a new local key or provide it through LOCAL_PUBLISHABLE_KEY_FILE"
    )
  }

  const keySalesChannels = Array.isArray(apiKey?.sales_channels)
    ? apiKey.sales_channels
        .map(asEntity)
        .filter((item): item is Entity => !!item)
        .map((item) => asString(item.id))
    : []
  if (!keySalesChannels.includes(salesChannelId)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: apiKeyId, add: [salesChannelId] },
    })
  }
  writeFileSync(publishableKeyPath, `${apiKeyToken}\n`, { mode: 0o600 })

  const inventoryItems = await listEntities(container, "inventory_item", [
    "id",
    "sku",
    "location_levels.*",
  ])
  let inventoryItem = inventoryItems.find(
    (item) => asString(item.sku) === "TEST-001"
  )
  if (!inventoryItem) {
    const { result } = await createInventoryItemsWorkflow(container).run({
      input: {
        items: [
          {
            sku: "TEST-001",
            location_levels: [{ location_id: locationId, stocked_quantity: 10 }],
          },
        ],
      },
    })
    inventoryItem = asEntity(result[0])
  } else {
    const levels = Array.isArray(inventoryItem.location_levels)
      ? inventoryItem.location_levels
          .map(asEntity)
          .filter((item): item is Entity => !!item)
      : []
    const hasLocationLevel = levels.some(
      (level) => asString(level.location_id) === locationId
    )
    if (!hasLocationLevel) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: [
            {
              inventory_item_id: requiredId(inventoryItem, "TEST-001 inventory"),
              location_id: locationId,
              stocked_quantity: 10,
            },
          ],
        },
      })
    }
  }
  const inventoryItemId = requiredId(inventoryItem, "TEST-001 inventory")

  const products = await listEntities(container, "product", [
    "id",
    "handle",
    "title",
    "status",
    "shipping_profile.id",
  ])
  let product = products.find(
    (item) => asString(item.handle) === "test-product"
  )
  if (!product) {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Test Product",
            handle: "test-product",
            status: "published",
            sales_channels: [{ id: salesChannelId }],
            options: [{ title: "Size", values: ["One Size"] }],
            variants: [
              {
                title: "Default",
                sku: "TEST-001",
                options: { Size: "One Size" },
                manage_inventory: true,
                inventory_items: [{ inventory_item_id: inventoryItemId }],
                prices: [{ amount: 10, currency_code: "usd" }],
              },
            ],
          },
        ],
      },
    })
    product = asEntity(result[0])
  }

  const productId = requiredId(product, "test-product")
  const profiles = await listEntities(container, "shipping_profile", [
    "id",
    "name",
    "type",
  ])
  let shippingProfile = profiles.find(
    (profile) =>
      asString(profile.name) === LOCAL_SHIPPING_FIXTURE.shippingProfileName
  )
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: {
        data: [
          {
            name: LOCAL_SHIPPING_FIXTURE.shippingProfileName,
            type: LOCAL_SHIPPING_FIXTURE.shippingProfileType,
          },
        ],
      },
    })
    shippingProfile = asEntity(result[0])
  }
  const shippingProfileId = requiredId(
    shippingProfile,
    "TEST-001 shipping profile"
  )
  const currentProduct = (
    await listEntities(container, "product", ["id", "shipping_profile.id"])
  ).find((item) => asString(item.id) === productId)
  const currentProductShippingProfileId = asString(
    asEntity(currentProduct?.shipping_profile)?.id
  )
  if (currentProductShippingProfileId !== shippingProfileId) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: productId },
        update: { shipping_profile_id: shippingProfileId },
      },
    })
  }
  const verifiedProduct = (
    await listEntities(container, "product", ["id", "shipping_profile.id"])
  ).find((item) => asString(item.id) === productId)
  if (
    asString(asEntity(verifiedProduct?.shipping_profile)?.id) !==
    shippingProfileId
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Local bootstrap could not link TEST-001 to the Standard Shipping profile"
    )
  }

  const shippingOptions = await listEntities(container, "shipping_option", [
    "id",
    "name",
    "price_type",
    "service_zone_id",
    "shipping_profile_id",
    "provider_id",
    "type.*",
    "prices.*",
  ])
  let shippingOption = shippingOptions.find((option) =>
    isFixtureShippingOption(option, serviceZoneId, shippingProfileId)
  )
  if (!shippingOption) {
    const { result } = await createShippingOptionsWorkflow(container).run({
      input: [buildFixtureShippingOptionInput(serviceZoneId, shippingProfileId)],
    })
    shippingOption = asEntity(result[0])
  } else if (
    shippingOptionProblems(
      shippingOption as Parameters<typeof shippingOptionProblems>[0],
      serviceZoneId,
      shippingProfileId
    ).length
  ) {
    await updateShippingOptionsWorkflow(container).run({
      input: [
        {
          id: requiredId(shippingOption, "Standard Shipping option"),
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
        },
      ],
    })
  }
  const shippingOptionId = requiredId(
    shippingOption,
    "Standard Shipping option"
  )
  const resolvedShippingOption = (
    await listEntities(container, "shipping_option", [
      "id",
      "name",
      "price_type",
      "service_zone_id",
      "shipping_profile_id",
      "provider_id",
      "type.description",
      "prices.*",
    ])
  ).find((option) => asString(option.id) === shippingOptionId)
  const optionProblems = shippingOptionProblems(
    resolvedShippingOption as Parameters<typeof shippingOptionProblems>[0],
    serviceZoneId,
    shippingProfileId
  )
  if (optionProblems.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Local bootstrap could not resolve the expected Standard Shipping option: ${optionProblems.join(", ")}`
    )
  }

  return {
    store_id: requiredId(store ?? undefined, "local store"),
    region_id: regionId,
    sales_channel_id: salesChannelId,
    stock_location_id: locationId,
    publishable_key_file: publishableKeyPath,
    product_id: productId,
    fulfillment_set_id: fulfillmentSetId,
    service_zone_id: serviceZoneId,
    shipping_profile_id: shippingProfileId,
    shipping_option_id: shippingOptionId,
  }
}

export default runBootstrap
