import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { createCartApi } from "../src/lib/cart-api.ts"

const require = createRequire(import.meta.url)
const medusa = dirname(require.resolve("@medusajs/medusa/package.json"))
const validators = require(join(medusa, "dist/api/store/carts/validators.js"))
const { transformAndValidateSalesChannelIds } = require(join(medusa, "dist/api/utils/middlewares/products/filter-by-valid-sales-channels.js"))

test("generated create/add/update bodies satisfy installed Medusa 2.23 schemas, including country-only addresses", async () => {
  const bodies = []
  const api = createCartApi({ NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://127.0.0.1:1", NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_offline" }, async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return Response.json({ cart: { id: "cart_one", region_id: "reg_one", shipping_address: { country_code: "us" }, currency_code: "usd", sales_channel_id: "sc_one", completed_at: null, items: [] } })
  })
  await api.create({ id: "reg_one", name: "Region", countryCode: "us", currencyCode: "usd" })
  await api.add("cart_one", "variant_one", 2)
  await api.update("cart_one", "cali_one", 3)
  assert.equal(validators.CreateCart.safeParse(bodies[0]).success, true)
  assert.equal(validators.StoreAddCartLineItem.safeParse(bodies[1]).success, true)
  assert.equal(validators.StoreUpdateCartLineItem.safeParse(bodies[2]).success, true)
})

test("installed Medusa validates channel probes against key scope even for empty catalogs", () => {
  const request = { publishable_key_context: { sales_channel_ids: ["sc_current"] }, validatedQuery: { sales_channel_id: "sc_current", fields: "id", limit: 1 } }
  assert.deepEqual(transformAndValidateSalesChannelIds(request), ["sc_current"])
  assert.throws(() => transformAndValidateSalesChannelIds({ ...request, validatedQuery: { ...request.validatedQuery, sales_channel_id: "sc_old" } }), (error) => error.type === "invalid_data")
})
