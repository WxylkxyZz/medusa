import { writeFileSync } from "node:fs"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

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

  if (asString(region?.currency_code)?.toLowerCase() !== "usd") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The existing United States region is not configured for USD"
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

  return {
    store_id: requiredId(store ?? undefined, "local store"),
    region_id: regionId,
    sales_channel_id: salesChannelId,
    stock_location_id: locationId,
    publishable_key_file: publishableKeyPath,
    product_id: requiredId(product, "test-product"),
  }
}

export default runBootstrap
