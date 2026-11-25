import test from "node:test"
import assert from "node:assert/strict"
import { createCartApi, toSavedCart } from "../src/lib/cart-api.ts"
import { createCartService } from "../src/lib/cart-service.ts"
import { CartError, cartErrorMessage, validateMutation } from "../src/lib/cart.ts"
import { CART_COOKIE, cartCookiePolicy, verifyCartOrigin } from "../src/lib/cart-policy.ts"
import { canPurchase, formatPrice } from "../src/lib/catalog.ts"

const env = {
  MEDUSA_BACKEND_URL_INTERNAL: "http://backend.internal:9000",
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://public.example.com",
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_offline_test", NEXT_PUBLIC_DEFAULT_REGION: "us", MEDUSA_SALES_CHANNEL_ID: "sc_one",
}
const region = { id: "reg_us", name: "US", currencyCode: "usd", countryCode: "us" }
const variant = { id: "variant_one", title: "Small", options: [{ optionId: "opt_size", value: "S" }], price: { amount: 19.99, currencyCode: "usd" }, manageInventory: true, allowBackorder: false, inventoryQuantity: 5 }
const product = { id: "prod_one", handle: "shirt", title: "Shirt", options: [{ id: "opt_size", title: "Size", values: ["S"] }], variants: [variant] }
const rawLine = { id: "cali_one", variant_id: "variant_one", product_handle: "shirt", product_title: "Shirt", variant_title: "Small", quantity: 2, unit_price: 19.99, subtotal: 39.98, total: 39.98, thumbnail: "https://images.example.com/shirt.jpg", is_tax_inclusive: false }
const rawCart = { id: "cart_secret", region_id: "reg_us", shipping_address: { country_code: "us" }, currency_code: "usd", sales_channel_id: "sc_one", completed_at: null, items: [rawLine], subtotal: 39.98, total: 39.98, tax_total: 0, discount_total: 0 }
const kind = (expected) => (error) => error instanceof CartError && error.kind === expected
const add = { action: "add", handle: "shirt", variantId: "variant_one", quantity: 1 }

function setup(responses = [], { cookie: initialCookie, product: currentProduct = product, overrides = {} } = {}) {
  const calls = []
  const writes = []
  let cookie = initialCookie
  const api = createCartApi({ ...env, ...overrides }, async (url, init) => {
    calls.push({ url: new URL(url), init })
    assert.ok(responses.length, "unexpected backend request")
    const value = responses.shift()
    if (value instanceof Error) throw value
    return value instanceof Response ? value : Response.json(value)
  })
  const service = createCartService({ api, region, cookie: {
    read: () => cookie, save: (id) => { writes.push(id); cookie = id }, clear: () => { writes.push(null); cookie = undefined },
  }, getProduct: async (handle) => { assert.equal(handle, "shirt"); return currentProduct } })
  return { api, service, calls, writes, cookie: () => cookie }
}

test("cookie uses configured URL, not NODE_ENV, and is httpOnly/sameSite/path scoped", () => {
  assert.equal(CART_COOKIE, "medusa_guest_cart")
  for (const base of ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"]) {
    const policy = cartCookiePolicy(base)
    assert.deepEqual(policy.options, { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 2592000 })
  }
  assert.equal(cartCookiePolicy("https://shop.example.com").options.secure, true)
  for (const base of [undefined, "", "bogus", "http://shop.example.com", "https://user:secret@example.com", "https://example.com?a=1", "https://example.com/#x", "https://example.com/path", "file:///tmp"]) assert.throws(() => cartCookiePolicy(base), kind("configuration"))
})

test("CSRF requires exact configured origin and JSON, ignores spoofed Host and forwarded host", () => {
  const base = "http://localhost:8000"
  const good = { origin: base, "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" }
  verifyCartOrigin(new Headers(good), base)
  verifyCartOrigin(new Headers({ origin: base, "content-type": "application/json" }), base)
  for (const change of [{ origin: "https://evil.example" }, { origin: "null" }, { origin: "" }, { origin: "http://localhost:8001" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }, { "content-type": "application/x-www-form-urlencoded" }]) {
    assert.throws(() => verifyCartOrigin(new Headers({ ...good, ...change, host: "localhost:8000", "x-forwarded-host": "localhost:8000" }), base), kind("origin"))
  }
})

test("strict mutation validation allows only exact fields, bounded IDs, and integer quantities", () => {
  for (const value of [add, { action: "update", lineId: "cali_one", quantity: 99 }, { action: "remove", lineId: "cali_one" }, { action: "reset" }]) assert.deepEqual(validateMutation(value), value)
  const invalid = [null, [], "add", {}, { action: "__proto__" }, { ...add, cartId: "cart_external" }, { ...add, url: "https://evil.example" }, { ...add, metadata: {} }, { ...add, quantity: undefined }, { action: "reset", cartId: "other" }, { action: "remove", lineId: "cali_one", quantity: 0 }]
  for (const quantity of [0, -1, 1.5, NaN, Infinity, -Infinity, 100, "1", null, Number.MAX_SAFE_INTEGER]) {
    invalid.push({ ...add, quantity }, { action: "update", lineId: "cali_one", quantity })
  }
  for (const id of ["", "a".repeat(129), "../other", "line/other", "?key=secret", 5, null, " space", "x\n"]) invalid.push({ ...add, variantId: id }, { action: "remove", lineId: id }, { action: "update", lineId: id, quantity: 1 })
  for (const handle of ["", ".", "..", "a".repeat(257), null, "x\n"]) invalid.push({ ...add, handle })
  for (const value of invalid) assert.throws(() => validateMutation(value), kind("input"))
})

test("public cart projection preserves major units and explicit returned totals, strips secrets and unsafe images", () => {
  const saved = toSavedCart({ ...rawCart, metadata: { private: "SECRET" }, email: "private", items: [{ ...rawLine, metadata: { private: "SECRET" }, thumbnail: "javascript:alert(1)" }] })
  assert.equal(formatPrice(saved.cart.lines[0].unitPrice), "$19.99")
  assert.equal(formatPrice(saved.cart.total), "$39.98")
  assert.equal(saved.cart.taxTotal.amount, 0)
  assert.equal(saved.cart.lines[0].thumbnail, null)
  assert.doesNotMatch(JSON.stringify(saved.cart), /SECRET|cart_secret|reg_us|sc_one|private|metadata/)
  const missing = toSavedCart({ ...rawCart, subtotal: undefined, total: undefined, tax_total: undefined, discount_total: undefined, items: [{ ...rawLine, total: undefined, subtotal: undefined }] })
  assert.equal(missing.cart.total, null)
  assert.equal(missing.cart.lines[0].total, null) // Never derive a fake grand/line total.
})

test("cart projection rejects invalid amounts, malformed records and duplicate lines", () => {
  const malformed = [null, {}, { ...rawCart, currency_code: "invalid" }, { ...rawCart, items: "bad" }, { ...rawCart, completed_at: undefined }, { ...rawCart, items: [rawLine, rawLine] }]
  for (const total of [-1, NaN, Infinity, "39.98"]) malformed.push({ ...rawCart, total })
  for (const quantity of [0, -1, 1.1, "1"]) malformed.push({ ...rawCart, items: [{ ...rawLine, quantity }] })
  malformed.push({ ...rawCart, items: [{ ...rawLine, unit_price: null }] })
  for (const value of malformed) assert.throws(() => toSavedCart(value), kind("backend"))
})

test("empty browser reads no remote cart; first add creates matching region/currency/channel then persists before add", async () => {
  const ctx = setup([{ cart: { ...rawCart, items: [] } }, { cart: { ...rawCart, items: [{ ...rawLine, quantity: 1 }] } }])
  assert.deepEqual(await ctx.service.read(), { cart: null })
  assert.equal(ctx.calls.length, 0)
  await ctx.service.mutate(add)
  assert.deepEqual(ctx.writes, ["cart_secret"])
  assert.equal(ctx.cookie(), "cart_secret")
  assert.equal(ctx.calls.length, 2)
  const [create, append] = ctx.calls
  assert.equal(create.url.pathname, "/store/carts")
  assert.equal(create.init.method, "POST")
  assert.deepEqual(JSON.parse(create.init.body), { region_id: "reg_us", currency_code: "usd", shipping_address: { country_code: "us" }, sales_channel_id: "sc_one" })
  assert.equal(append.url.pathname, "/store/carts/cart_secret/line-items")
  assert.deepEqual(JSON.parse(append.init.body), { variant_id: "variant_one", quantity: 1 })
  for (const call of ctx.calls) {
    assert.equal(call.url.origin, "http://backend.internal:9000")
    assert.match(call.url.searchParams.get("fields"), /items.total/)
    assert.equal(call.init.headers["x-publishable-api-key"], "pk_offline_test")
    assert.equal(call.init.headers["Content-Type"], "application/json")
    assert.equal(call.init.cache, "no-store")
    assert.equal(call.init.redirect, "error")
    assert.equal(call.init.credentials, "omit")
    assert.ok(call.init.signal instanceof AbortSignal)
  }
})

test("without optional sales channel create lets Medusa infer the key's single authorized channel", async () => {
  const ctx = setup([{ cart: rawCart }], { overrides: { MEDUSA_SALES_CHANNEL_ID: " " } })
  await ctx.api.create(region)
  assert.deepEqual(JSON.parse(ctx.calls[0].init.body), { region_id: "reg_us", currency_code: "usd", shipping_address: { country_code: "us" } })
})

test("implicit channel is reauthorized with the current publishable key before reading or mutating a saved cart", async () => {
  const ctx = setup([{ cart: rawCart }, { products: [], count: 0 }, { cart: rawCart }, { products: [], count: 0 }, { cart: rawCart }], { cookie: "cart_secret", overrides: { MEDUSA_SALES_CHANNEL_ID: undefined } })
  assert.equal((await ctx.service.read()).cart.lines.length, 1)
  await ctx.service.mutate(add)
  const probes = ctx.calls.filter((call) => call.url.pathname === "/store/products")
  assert.equal(probes.length, 2)
  for (const probe of probes) {
    assert.equal(probe.init.method, "GET")
    assert.equal(probe.url.searchParams.get("sales_channel_id"), "sc_one")
    assert.equal(probe.url.searchParams.get("fields"), "id")
    assert.equal(probe.url.searchParams.get("limit"), "1")
    assert.equal(probe.init.headers["x-publishable-api-key"], "pk_offline_test")
  }
  assert.deepEqual(ctx.writes, [])
})

test("key rotation rejects an unauthorized saved channel without touching the cart", async () => {
  for (const action of ["read", "add", "update", "remove"]) {
    const ctx = setup([{ cart: rawCart }, Response.json({ type: "invalid_data", message: "Requested sales channel is not part of the publishable key" }, { status: 400 })], { cookie: "cart_secret", overrides: { MEDUSA_SALES_CHANNEL_ID: undefined } })
    if (action === "read") assert.deepEqual(await ctx.service.read(), { cart: null, issue: "mismatch" })
    else await assert.rejects(ctx.service.mutate(action === "add" ? add : { action, lineId: "cali_one", ...(action === "update" ? { quantity: 1 } : {}) }), kind("mismatch"))
    assert.ok(ctx.calls.every((call) => call.init.method === "GET"))
    assert.equal(ctx.cookie(), "cart_secret")
    assert.deepEqual(ctx.writes, [])
  }
})

test("channel probe failures do not masquerade as expired carts or permit a write", async () => {
  for (const [response, expected] of [[new Response("private", { status: 503 }), "backend"], [new Response("private", { status: 401 }), "configuration"], [{ products: "bad", count: 0 }, "backend"], [new Error("network"), "backend"]]) {
    const ctx = setup([{ cart: rawCart }, response], { cookie: "cart_secret", overrides: { MEDUSA_SALES_CHANNEL_ID: undefined } })
    await assert.rejects(ctx.service.mutate(add), kind(expected))
    assert.ok(ctx.calls.every((call) => call.init.method === "GET"))
    assert.equal(ctx.cookie(), "cart_secret")
    assert.deepEqual(ctx.writes, [])
  }
})

test("existing cookie survives refresh and add reuses cart without creating/resetting", async () => {
  const ctx = setup([{ cart: rawCart }, { cart: rawCart }, { cart: rawCart }], { cookie: "cart_secret" })
  assert.equal((await ctx.service.read()).cart.lines[0].quantity, 2)
  await ctx.service.mutate(add)
  assert.deepEqual(ctx.calls.map((call) => [call.init.method, call.url.pathname]), [["GET", "/store/carts/cart_secret"], ["GET", "/store/carts/cart_secret"], ["POST", "/store/carts/cart_secret/line-items"]])
  assert.deepEqual(ctx.writes, [])
  assert.equal(ctx.cookie(), "cart_secret")
})

test("update validates membership and posts only quantity; remove consumes Medusa parent response", async () => {
  const updated = { ...rawCart, items: [{ ...rawLine, quantity: 3 }] }
  const ctx = setup([{ cart: rawCart }, { cart: updated }, { cart: updated }, { parent: { ...rawCart, items: [] }, deleted: true, id: "cali_one", object: "line-item" }], { cookie: "cart_secret" })
  await ctx.service.mutate({ action: "update", lineId: "cali_one", quantity: 3 })
  await ctx.service.mutate({ action: "remove", lineId: "cali_one" })
  assert.equal(ctx.calls[1].init.method, "POST")
  assert.equal(ctx.calls[1].url.pathname, "/store/carts/cart_secret/line-items/cali_one")
  assert.deepEqual(JSON.parse(ctx.calls[1].init.body), { quantity: 3 })
  assert.equal(ctx.calls[3].init.method, "DELETE")
  assert.equal(ctx.calls[3].init.body, undefined)
  assert.equal(ctx.calls[3].url.pathname, "/store/carts/cart_secret/line-items/cali_one")
})

test("country projection is normalized, excludes private address data, and validates malformed countries", () => {
  const saved = toSavedCart({ ...rawCart, shipping_address: { country_code: "US", address_1: "PRIVATE_ADDRESS", phone: "PRIVATE_PHONE" } })
  assert.equal(saved.countryCode, "us")
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_ADDRESS|PRIVATE_PHONE|address_1|phone/)
  assert.equal(toSavedCart({ ...rawCart, shipping_address: null }).countryCode, null)
  for (const shipping_address of ["bad", [], {}, { country_code: "USA" }, { country_code: 1 }]) {
    assert.throws(() => toSavedCart({ ...rawCart, shipping_address }), kind("backend"))
  }
})

test("cart creation explicitly selects the configured country within a multi-country region", async () => {
  const ctx = setup([{ cart: { ...rawCart, shipping_address: { country_code: "ca" }, items: [] } }])
  await ctx.api.create({ ...region, countryCode: "ca" })
  assert.deepEqual(JSON.parse(ctx.calls[0].init.body).shipping_address, { country_code: "ca" })
  assert.match(ctx.calls[0].url.searchParams.get("fields"), /shipping_address\.country_code/)
})

test("quantity increases reject unavailable products and variants without sending a write", async () => {
  for (const currentProduct of [null, { ...product, variants: [] }, { ...product, variants: [{ ...variant, options: [] }] }]) {
    const ctx = setup([{ cart: rawCart }], { cookie: "cart_secret", product: currentProduct })
    await assert.rejects(ctx.service.mutate({ action: "update", lineId: "cali_one", quantity: 3 }), kind("variant"))
    assert.equal(ctx.calls.length, 1)
    assert.equal(ctx.calls[0].init.method, "GET")
    assert.equal(ctx.cookie(), "cart_secret")
  }
  for (const missing of [{ product_handle: null }, { variant_id: null }]) {
    const ctx = setup([{ cart: { ...rawCart, items: [{ ...rawLine, ...missing }] } }], { cookie: "cart_secret" })
    await assert.rejects(ctx.service.mutate({ action: "update", lineId: "cali_one", quantity: 3 }), kind("variant"))
    assert.equal(ctx.calls.length, 1)
  }
})

test("unavailable products still allow decreases and removal", async () => {
  for (const action of ["update", "remove"]) {
    const response = { ...rawCart, items: action === "remove" ? [] : [{ ...rawLine, quantity: 1 }] }
    const ctx = setup([{ cart: rawCart }, action === "remove" ? { parent: response } : { cart: response }], { cookie: "cart_secret", product: null })
    await ctx.service.mutate({ action, lineId: "cali_one", ...(action === "update" ? { quantity: 1 } : {}) })
    assert.equal(ctx.calls.length, 2)
    assert.equal(ctx.calls[1].init.method, action === "remove" ? "DELETE" : "POST")
  }
})

test("quantity increases leave quantity-dependent price and inventory validation to Medusa", async () => {
  const ctx = setup([{ cart: rawCart }, { cart: { ...rawCart, items: [{ ...rawLine, quantity: 3 }] } }], {
    cookie: "cart_secret", product: { ...product, variants: [{ ...variant, price: null }] },
  })
  await ctx.service.mutate({ action: "update", lineId: "cali_one", quantity: 3 })
  assert.equal(ctx.calls.length, 2)
  assert.deepEqual(JSON.parse(ctx.calls[1].init.body), { quantity: 3 })
})

test("foreign line and missing browser cart never permit update or delete", async () => {
  for (const action of ["update", "remove"]) {
    for (const cookie of [undefined, "cart_secret"]) {
      const ctx = setup(cookie ? [{ cart: rawCart }] : [], { cookie })
      const input = { action, lineId: "cali_external", ...(action === "update" ? { quantity: 2 } : {}) }
      await assert.rejects(ctx.service.mutate(input), kind("line"))
      assert.equal(ctx.calls.filter((call) => call.init.method !== "GET").length, 0)
    }
  }
})

for (const [label, changed] of Object.entries({ region: { region_id: "reg_eu" }, country: { shipping_address: { country_code: "ca" } }, "missing country": { shipping_address: null }, currency: { currency_code: "eur" }, channel: { sales_channel_id: "sc_other" }, completed: { completed_at: "2026-01-01" } })) {
  test(`saved ${label} mismatch is explicit and never creates/migrates/deletes a cart`, async () => {
    const ctx = setup([{ cart: { ...rawCart, ...changed } }, { cart: { ...rawCart, ...changed } }], { cookie: "cart_secret" })
    const issue = label === "completed" ? "completed" : "mismatch"
    assert.deepEqual(await ctx.service.read(), { cart: null, issue })
    await assert.rejects(ctx.service.mutate(add), kind(issue))
    assert.equal(ctx.calls.length, 2)
    assert.ok(ctx.calls.every((call) => call.init.method === "GET"))
    assert.deepEqual(ctx.writes, [])
  })
}

test("404/expired cookie needs explicit local reset; reset never deletes remote data and next add creates a new cart", async () => {
  const ctx = setup([new Response("private", { status: 404 }), { cart: { ...rawCart, items: [] } }, { cart: rawCart }], { cookie: "cart_expired" })
  assert.deepEqual(await ctx.service.read(), { cart: null, issue: "missing" })
  assert.equal(ctx.cookie(), "cart_expired")
  await ctx.service.mutate({ action: "reset" })
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.cookie(), undefined)
  await ctx.service.mutate(add)
  assert.deepEqual(ctx.writes, [null, "cart_secret"])
  assert.equal(ctx.calls.filter((call) => call.init.method === "DELETE").length, 0)
})

test("invalid cookie is deliberately expired, not interpolated into paths; invalid mutations never touch backend", async () => {
  const ctx = setup([], { cookie: "../other" })
  assert.deepEqual(await ctx.service.read(), { cart: null, issue: "missing" })
  await assert.rejects(ctx.service.mutate({ ...add, quantity: NaN }), kind("input"))
  await assert.rejects(ctx.service.mutate(add), kind("missing"))
  assert.equal(ctx.calls.length, 0)
  await ctx.service.mutate({ action: "reset" })
  assert.equal(ctx.cookie(), undefined)
})

for (const status of [400, 401, 403, 429, 500, 503]) {
  test(`retrieve HTTP ${status} never acts like a missing cart or clears cookie`, async () => {
    const ctx = setup([new Response("private body", { status })], { cookie: "cart_secret" })
    await assert.rejects(ctx.service.read(), kind([401, 403].includes(status) ? "configuration" : "backend"))
    assert.equal(ctx.cookie(), "cart_secret")
    assert.deepEqual(ctx.writes, [])
    assert.equal(ctx.calls.length, 1)
  })
}

test("timeouts, network errors and mismatched remote cart IDs are not expired carts", async () => {
  for (const failure of [new Error("internal-host/token/SECRET"), new DOMException("timeout", "TimeoutError"), { cart: { ...rawCart, id: "cart_other" } }, new Response("not json")]) {
    const ctx = setup([failure], { cookie: "cart_secret" })
    await assert.rejects(ctx.service.read(), kind("backend"))
    assert.equal(ctx.cookie(), "cart_secret")
    assert.equal(ctx.calls.length, 1)
  }
})

test("purchase eligibility is conservative for unknown/unpriced/incomplete inventory, honors unmanaged/backorder/zero price", async () => {
  const disabled = [undefined, { ...variant, price: null }, { ...variant, price: { amount: NaN, currencyCode: "usd" } }, { ...variant, inventoryQuantity: 0 }, { ...variant, inventoryQuantity: null }, { ...variant, inventoryQuantity: Infinity }, { ...variant, manageInventory: null }]
  for (const item of disabled) assert.equal(canPurchase(item), false)
  for (const item of [{ ...variant, price: { amount: 0, currencyCode: "usd" } }, { ...variant, manageInventory: false, inventoryQuantity: null }, { ...variant, inventoryQuantity: 0, allowBackorder: true }]) assert.equal(canPurchase(item), true)
  assert.equal(canPurchase(variant, 6), false)
  assert.equal(canPurchase(variant, 0), false)
  for (const item of disabled.filter(Boolean)) {
    const ctx = setup([], { product: { ...product, variants: [item] } })
    await assert.rejects(ctx.service.mutate(add), (error) => ["stock", "variant"].includes(error.kind))
    assert.equal(ctx.calls.length, 0)
  }
  for (const p of [null, { ...product, variants: [] }, { ...product, variants: [{ ...variant, options: [] }] }]) {
    const ctx = setup([], { product: p })
    await assert.rejects(ctx.service.mutate(add), kind("variant"))
    assert.equal(ctx.calls.length, 0)
  }
})

test("adding checks aggregate existing quantity and inventory; cart cannot exceed local bound", async () => {
  for (const [quantity, expected] of [[5, "stock"], [99, "input"]]) {
    const ctx = setup([{ cart: rawCart }], { cookie: "cart_secret" })
    await assert.rejects(ctx.service.mutate({ ...add, quantity }), kind(expected))
    assert.equal(ctx.calls.length, 1)
  }
})

for (const [name, failure, expected] of [
  ["stock", Response.json({ code: "insufficient_inventory", type: "not_allowed", message: "private diagnostic" }, { status: 400 }), "stock"],
  ["provider rejection", Response.json({ type: "not_allowed", message: "private provider" }, { status: 400 }), "rejected"],
  ["server", new Response("private diagnostic", { status: 500 }), "uncertain"],
  ["network", new Error("internal-host:9000?key=SECRET"), "uncertain"],
  ["timeout", new DOMException("timed out", "TimeoutError"), "uncertain"],
  ["invalid success", { cart: {} }, "uncertain"],
  ["not found during write", new Response("private", { status: 404 }), "uncertain"],
]) {
  test(`add ${name} is safe, never automatically retried and keeps created cookie`, async () => {
    const ctx = setup([{ cart: { ...rawCart, items: [] } }, failure])
    await assert.rejects(ctx.service.mutate(add), (error) => {
      assert.equal(error.kind, expected)
      assert.doesNotMatch(cartErrorMessage(error), /internal-host|SECRET|private|provider/)
      return true
    })
    assert.equal(ctx.calls.length, 2)
    assert.equal(ctx.cookie(), "cart_secret")
    assert.deepEqual(ctx.writes, ["cart_secret"])
    assert.equal(ctx.calls.filter((call) => call.url.pathname.endsWith("/line-items")).length, 1)
  })
}

test("cart create failure is not retried or persisted; auth/setup errors are distinct", async () => {
  for (const status of [401, 403, 500]) {
    const ctx = setup([new Response("SECRET", { status })])
    await assert.rejects(ctx.service.mutate(add), kind(status === 500 ? "uncertain" : "configuration"))
    assert.equal(ctx.calls.length, 1)
    assert.equal(ctx.cookie(), undefined)
    assert.deepEqual(ctx.writes, [])
  }
})

test("successful write with changed identity/context is uncertain and not retried", async () => {
  for (const changed of [{ id: "cart_other" }, { region_id: "reg_other" }, { completed_at: "2026-01-01" }]) {
    const ctx = setup([{ cart: rawCart }, { cart: { ...rawCart, ...changed } }], { cookie: "cart_secret" })
    await assert.rejects(ctx.service.mutate(add), kind("uncertain"))
    assert.equal(ctx.calls.length, 2)
    assert.equal(ctx.cookie(), "cart_secret")
  }
})

test("add to a truly missing cart does not silently replace it", async () => {
  const ctx = setup([new Response("private diagnostic", { status: 404 })], { cookie: "cart_expired" })
  await assert.rejects(ctx.service.mutate(add), kind("missing"))
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.cookie(), "cart_expired")
  assert.deepEqual(ctx.writes, [])
})

test("all cart error messages and unknown errors are safe and reset policy is explicit", () => {
  assert.match(cartErrorMessage(new CartError("mismatch")), /not been changed/)
  assert.match(cartErrorMessage(new CartError("completed")), /orders will not be changed/)
  assert.equal(cartErrorMessage(new Error("SECRET internal hostname")), cartErrorMessage(new CartError("backend")))
  assert.doesNotMatch(cartErrorMessage(new Error("SECRET internal hostname")), /SECRET|hostname/)
})
