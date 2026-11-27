import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { createCheckoutApi, toSavedCheckoutCart, checkoutCartFields, shippingOptionFields } from "../src/lib/checkout-api.ts"
import {
  CheckoutError,
  checkoutErrorMessage,
  checkoutCartProjection,
  normalizeCheckoutAddress,
  projectShippingOptions,
  validateCheckoutMutation,
} from "../src/lib/checkout.ts"
import { createCheckoutService } from "../src/lib/checkout-service.ts"
import { StoreRequestError } from "../src/lib/medusa-http.ts"

const require = createRequire(import.meta.url)
const medusa = dirname(require.resolve("@medusajs/medusa/package.json"))
const cartValidators = require(join(medusa, "dist/api/store/carts/validators.js"))
const shippingValidators = require(join(medusa, "dist/api/store/shipping-options/validators.js"))

const env = {
  MEDUSA_BACKEND_URL_INTERNAL: "http://backend.internal:9000",
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://public.example.com",
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_offline_test",
  NEXT_PUBLIC_DEFAULT_REGION: "us",
  MEDUSA_SALES_CHANNEL_ID: "sc_one",
}
const region = { id: "reg_us", name: "US", currencyCode: "usd", countryCode: "us" }
const rawLine = {
  id: "cali_one", variant_id: "variant_one", product_handle: "shirt", product_title: "Shirt", variant_title: "Small",
  quantity: 2, unit_price: 19.99, subtotal: 39.98, total: 39.98, thumbnail: "https://images.example.com/shirt.jpg", is_tax_inclusive: false,
}
const rawCart = {
  id: "cart_secret", region_id: "reg_us", shipping_address: {
    first_name: " Ada ", last_name: "Lovelace", address_1: "1 Main St", city: "London", postal_code: "12345", country_code: "US", province: "LN", phone: "+1 555 000", company: null,
  }, billing_address: null, currency_code: "usd", sales_channel_id: "sc_one", completed_at: null,
  items: [rawLine], subtotal: 39.98, item_subtotal: 39.98, total: 39.98, tax_total: 0, discount_total: 0, shipping_total: 0,
  shipping_methods: [], metadata: { private: "SECRET" },
}
const addressInput = {
  firstName: "  Ada  ", lastName: "Lovelace", address1: "1   Main St", address2: "", city: "London", province: "LN", postalCode: "12345", countryCode: "US", phone: "+1 555 000", company: "",
}
const option = { id: "so_standard", name: "Standard", price_type: "flat", amount: 7.5, calculated_price: { currency_code: "usd", calculated_amount: 7.5, is_calculated_price_tax_inclusive: false }, is_tax_inclusive: false, insufficient_inventory: false, provider: { id: "secret", data: { token: "secret" } } }
const responseCart = (overrides = {}) => ({ cart: { ...rawCart, ...overrides } })
const kind = (expected) => (error) => error instanceof CheckoutError && error.kind === expected

for (const [name, value] of Object.entries({
  "unknown field": { ...addressInput, metadata: {} },
  "missing first name": { ...addressInput, firstName: "" },
  "long phone": { ...addressInput, phone: "x".repeat(41) },
  "control city": { ...addressInput, city: "London\nprivate" },
  "bad country": { ...addressInput, countryCode: "USA" },
})) {
  test(`address validation rejects ${name} without backend data`, () => assert.throws(() => normalizeCheckoutAddress(value, "us"), kind(name === "bad country" ? "address" : name === "unknown field" ? "input" : "address")))
}

test("address normalization bounds fields, trims whitespace, lowercases country, and maps only Medusa address fields", () => {
  assert.deepEqual(normalizeCheckoutAddress(addressInput, "us"), {
    first_name: "Ada", last_name: "Lovelace", address_1: "1 Main St", city: "London", province: "LN", postal_code: "12345", country_code: "us", phone: "+1 555 000",
  })
  assert.throws(() => normalizeCheckoutAddress({ ...addressInput, countryCode: "ca" }, "us"), kind("mismatch"))
})

test("checkout mutation validation is strict and never accepts cart, region, metadata, provider, or payment identity", () => {
  for (const value of [
    { action: "list-shipping-options" },
    { action: "select-shipping", optionId: "so_standard" },
    { action: "update-address", address: addressInput, useSameBilling: true },
  ]) assert.deepEqual(validateCheckoutMutation(value), value)
  for (const value of [
    { action: "list-shipping-options", cartId: "cart_secret" },
    { action: "select-shipping", optionId: "so_standard", cart_id: "cart_secret" },
    { action: "select-shipping", optionId: "../other" },
    { action: "update-address", address: addressInput, useSameBilling: true, region_id: "reg_secret" },
    { action: "update-address", address: addressInput, useSameBilling: "yes" },
    { action: "update-address", address: { ...addressInput, metadata: {} }, useSameBilling: true },
    { action: "payment", payment_collection_id: "pay_secret" },
  ]) assert.throws(() => validateCheckoutMutation(value), kind("input"))
})

test("shipping option projection keeps actual major-unit money and strips provider data", () => {
  const projected = projectShippingOptions([option], "usd")
  assert.deepEqual(projected, [{ id: "so_standard", name: "Standard", priceType: "flat", amount: { amount: 7.5, currencyCode: "usd" }, currencyCode: "usd", isTaxInclusive: false, insufficientInventory: false }])
  assert.doesNotMatch(JSON.stringify(projected), /secret|provider|data/)
  assert.throws(() => projectShippingOptions([{ ...option, amount: undefined }], "usd"), kind("backend"))
  assert.throws(() => projectShippingOptions([{ ...option, calculated_price: { ...option.calculated_price, currency_code: "eur" } }], "usd"), kind("backend"))
  assert.throws(() => projectShippingOptions([{ ...option, calculated_price: { ...option.calculated_price, calculated_amount: 8 } }], "usd"), kind("backend"))
  assert.doesNotThrow(() => projectShippingOptions([{ ...option, calculated_price: { currency_code: "usd", calculated_amount: 7.5 } }], "usd"))
  assert.doesNotThrow(() => projectShippingOptions([{ ...option, amount: 0, calculated_price: { ...option.calculated_price, calculated_amount: 0 } }], "usd"))
})

test("checkout cart projection preserves full shipping address and selected shipping money but strips ids, metadata, billing PII, and provider fields", () => {
  const saved = toSavedCheckoutCart(rawCart)
  const cart = checkoutCartProjection(saved)
  assert.equal(cart.shippingAddress.countryCode, "us")
  assert.equal(cart.shippingAddress.firstName, " Ada ")
  assert.equal(cart.shippingTotal.amount, 0)
  assert.equal(cart.itemSubtotal.amount, 39.98)
  assert.deepEqual(cart.shippingMethods, [])
  assert.equal("billingAddress" in cart, false)
  assert.doesNotMatch(JSON.stringify(cart.cart) + JSON.stringify(cart.shippingAddress) + JSON.stringify(cart.shippingMethods), /SECRET|cart_secret|sc_one|metadata|provider|shipping_address_id/)
})

test("selected $5 shipping keeps the $10 item subtotal for the items line and $15 for Medusa's shipping-inclusive subtotal", async () => {
  const shipped = {
    ...rawCart,
    items: [{ ...rawLine, quantity: 1, unit_price: 10, subtotal: 10, total: 10 }],
    item_subtotal: 10, shipping_subtotal: 5, shipping_total: 5, subtotal: 15, total: 15,
    shipping_methods: [{ name: "Standard Shipping", shipping_option_id: "so_standard", amount: 5, is_tax_inclusive: false }],
  }
  const cart = checkoutCartProjection(toSavedCheckoutCart(shipped))
  assert.equal(cart.itemSubtotal.amount, 10)
  assert.equal(cart.shippingTotal.amount, 5)
  assert.equal(cart.shippingMethods[0].amount.amount, 5)
  assert.equal(cart.subtotal.amount, 15) // Medusa cart subtotal is items + shipping, never the items line.
  assert.equal(cart.total.amount, 15)
  assert.ok(checkoutCartFields.split(",").includes("item_subtotal"))
  const { api, calls } = mockApi([responseCart(shipped)])
  const saved = await api.retrieve("cart_secret")
  assert.equal(saved.cart.itemSubtotal.amount, 10)
  assert.equal(calls[0].url.searchParams.get("fields"), checkoutCartFields)
})

function mockApi(responses) {
  const calls = []
  const api = createCheckoutApi(env, async (url, init) => {
    calls.push({ url: new URL(url), init })
    assert.ok(responses.length, "unexpected backend request")
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json(next)
  })
  return { api, calls }
}

test("checkout API uses exact cart/shipping paths, allowlisted fields, cookie-owned cart query, and no provider data", async () => {
  const { api, calls } = mockApi([
    responseCart(),
    responseCart({ shipping_address: { ...rawCart.shipping_address, address_1: "2 Main St" } }),
    { shipping_options: [option] },
    responseCart({ shipping_methods: [{ id: "sm_secret", name: "Standard", shipping_option_id: "so_standard", amount: 7.5, is_tax_inclusive: false }] }),
  ])
  await api.retrieve("cart_secret")
  await api.updateAddress("cart_secret", normalizeCheckoutAddress(addressInput, "us"), normalizeCheckoutAddress(addressInput, "us"))
  const options = await api.listShippingOptions("cart_secret", "usd")
  await api.addShippingMethod("cart_secret", options[0].id)
  assert.deepEqual(calls.map((call) => [call.init.method, call.url.pathname]), [
    ["GET", "/store/carts/cart_secret"], ["POST", "/store/carts/cart_secret"], ["GET", "/store/shipping-options"], ["POST", "/store/carts/cart_secret/shipping-methods"],
  ])
  assert.equal(calls[0].url.searchParams.get("fields"), checkoutCartFields)
  assert.equal(calls[2].url.searchParams.get("cart_id"), "cart_secret")
  assert.equal(calls[2].url.searchParams.get("is_return"), "false")
  assert.equal(calls[2].url.searchParams.get("fields"), shippingOptionFields)
  assert.deepEqual(JSON.parse(calls[1].init.body), { shipping_address: { first_name: "Ada", last_name: "Lovelace", address_1: "1 Main St", city: "London", postal_code: "12345", country_code: "us", province: "LN", phone: "+1 555 000" }, billing_address: { first_name: "Ada", last_name: "Lovelace", address_1: "1 Main St", city: "London", postal_code: "12345", country_code: "us", province: "LN", phone: "+1 555 000" } })
  assert.deepEqual(JSON.parse(calls[3].init.body), { option_id: "so_standard" })
  for (const call of calls) {
    assert.equal(call.init.headers["x-publishable-api-key"], env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY)
    assert.equal(call.init.credentials, "omit")
    assert.equal(call.init.redirect, "error")
    assert.equal(call.init.cache, "no-store")
    assert.ok(call.init.signal instanceof AbortSignal)
  }
})

test("checkout requests satisfy the installed Medusa 2.23 update-cart, shipping-options, and add-shipping-method schemas", () => {
  const address = normalizeCheckoutAddress(addressInput, "us")
  assert.equal(cartValidators.UpdateCart.safeParse({ shipping_address: address, billing_address: address }).success, true)
  assert.equal(shippingValidators.StoreGetShippingOptions.safeParse({ cart_id: "cart_secret", is_return: "false", fields: shippingOptionFields }).success, true)
  assert.equal(cartValidators.StoreAddCartShippingMethods.safeParse({ option_id: "so_standard" }).success, true)
})

test("checkout service rejects a client option not returned for this cookie cart and never calls payment or complete", async () => {
  const calls = []
  const api = {
    salesChannelId: "sc_one",
    retrieve: async () => toSavedCheckoutCart(rawCart),
    validateSalesChannel: async () => {},
    listShippingOptions: async () => { calls.push("options"); return [projectShippingOptions([option], "usd")[0]] },
    addShippingMethod: async () => { calls.push("shipping-write"); return toSavedCheckoutCart(rawCart) },
    createPaymentCollection: async () => { calls.push("payment-collection") },
    complete: async () => { calls.push("complete") },
  }
  const service = createCheckoutService({ api, region, cookie: { read: () => "cart_secret" } })
  await assert.rejects(service.mutate({ action: "select-shipping", optionId: "so_foreign" }), kind("option"))
  assert.deepEqual(calls, ["options"])
})

test("shipping selection requires the cookie cart's complete region country address before listing options", async () => {
  let optionsCalled = false
  const api = {
    salesChannelId: "sc_one",
    retrieve: async () => toSavedCheckoutCart({ ...rawCart, shipping_address: null }),
    validateSalesChannel: async () => {},
    listShippingOptions: async () => { optionsCalled = true; return [projectShippingOptions([option], "usd")[0]] },
    addShippingMethod: async () => { throw new Error("must not call") },
  }
  const service = createCheckoutService({ api, region, cookie: { read: () => "cart_secret" } })
  await assert.rejects(service.mutate({ action: "select-shipping", optionId: "so_standard" }), kind("address"))
  assert.equal(optionsCalled, false)
})
test("address save treats a successful but unreconciled cart response as uncertain", async () => {
  const api = {
    salesChannelId: "sc_one",
    retrieve: async () => toSavedCheckoutCart(rawCart),
    validateSalesChannel: async () => {},
    updateAddress: async () => toSavedCheckoutCart(rawCart),
    listShippingOptions: async () => [],
    addShippingMethod: async () => { throw new Error("must not call") },
  }
  const service = createCheckoutService({ api, region, cookie: { read: () => "cart_secret" } })
  await assert.rejects(service.mutate({ action: "update-address", address: { ...addressInput, address1: "2 Main St" }, useSameBilling: true }), kind("uncertain"))
})

test("shipping selection treats a successful but unreconciled cart response as uncertain", async () => {
  const api = {
    salesChannelId: "sc_one",
    retrieve: async () => toSavedCheckoutCart(rawCart),
    validateSalesChannel: async () => {},
    listShippingOptions: async () => [projectShippingOptions([option], "usd")[0]],
    addShippingMethod: async () => toSavedCheckoutCart(rawCart),
  }
  const service = createCheckoutService({ api, region, cookie: { read: () => "cart_secret" } })
  await assert.rejects(service.mutate({ action: "select-shipping", optionId: "so_standard" }), kind("uncertain"))
})

test("shipping no-options and upstream failures remain explicit rather than becoming free shipping", async () => {
  for (const [options, expected] of [[[], "none"], [new Response("private", { status: 400 }), "configuration"], [new Response("private", { status: 503 }), "backend"]]) {
    const calls = []
    const api = {
      salesChannelId: "sc_one", retrieve: async () => toSavedCheckoutCart(rawCart), validateSalesChannel: async () => {},
      listShippingOptions: async () => { calls.push("options"); if (options instanceof Response) throw new StoreRequestError(options.status); return options },
      addShippingMethod: async () => { throw new Error("must not call") },
    }
    const state = await createCheckoutService({ api, region, cookie: { read: () => "cart_secret" } }).read()
    assert.equal(state.shippingState, expected)
    assert.deepEqual(state.shippingOptions, [])
    assert.deepEqual(calls, ["options"])
  }
  assert.match(checkoutErrorMessage(new CheckoutError("configuration")), /not configured/)
})
