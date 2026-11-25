import test from "node:test"
import assert from "node:assert/strict"
import { CatalogError, catalogErrorMessage, createStoreApi, toProduct } from "../src/lib/store-api.ts"
import { PAGE_SIZE } from "../src/lib/catalog.ts"

const env = {
  MEDUSA_BACKEND_URL_INTERNAL: "http://backend.internal:9000",
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://public.example.com",
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_test_offline",
  NEXT_PUBLIC_DEFAULT_REGION: "us",
}
const rawRegion = { id: "reg_us", name: "United States", currency_code: "usd", countries: [{ iso_2: "us" }] }
const region = { id: "reg_us", name: "United States", currencyCode: "usd", countryCode: "us" }
const rawProduct = {
  id: "prod_one", handle: "shirt", title: "Shirt", subtitle: null, description: "<script>alert(1)</script>", status: "published",
  thumbnail: "https://images.example.com/shirt.jpg", images: [{ url: "javascript:alert(1)" }, { url: "https://images.example.com/shirt.jpg" }],
  options: [{ id: "opt_size", title: "Size", values: [{ value: "S" }] }],
  variants: [{ id: "var_small", title: "Small", sku: "SHIRT-S", options: [{ option_id: "opt_size", value: "S" }],
    manage_inventory: true, allow_backorder: false, inventory_quantity: 3,
    calculated_price: { calculated_amount: 19.99, original_amount: 29.99, currency_code: "usd" }, metadata: { private: "never-serialize" } }],
  collection: { title: "Basics", metadata: { internal: "never-serialize" } }, material: "Cotton", metadata: { internal: "never-serialize" },
}
function mockApi(responses, overrides = {}) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url: new URL(url), init })
    assert.ok(responses.length, "Unexpected request")
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json(next)
  }
  return { api: createStoreApi({ ...env, ...overrides }, fetcher), calls }
}
const regionResponse = (regions = [rawRegion], count = regions.length) => ({ regions, count })
const productResponse = (products = [rawProduct], count = products.length) => ({ products, count })
const hasKind = (kind) => (error) => error instanceof CatalogError && error.kind === kind

for (const [name, overrides] of Object.entries({
  "missing key": { NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "" },
  "missing country": { NEXT_PUBLIC_DEFAULT_REGION: "" },
  "region ID is not a country": { NEXT_PUBLIC_DEFAULT_REGION: "reg_us" },
  "missing URL": { MEDUSA_BACKEND_URL_INTERNAL: "", NEXT_PUBLIC_MEDUSA_BACKEND_URL: "" },
  "invalid internal URL cannot fall back": { MEDUSA_BACKEND_URL_INTERNAL: "not-a-url" },
  "unsafe protocol": { MEDUSA_BACKEND_URL_INTERNAL: "file:///tmp/api" },
  "credentials in URL": { MEDUSA_BACKEND_URL_INTERNAL: "https://user:secret@example.com" },
  "query in URL": { MEDUSA_BACKEND_URL_INTERNAL: "https://example.com?token=secret" },
})) {
  test(`configuration fails honestly before fetch: ${name}`, () => {
    assert.throws(() => createStoreApi({ ...env, ...overrides }, () => { assert.fail("must not fetch") }), hasKind("configuration"))
  })
}

test("server prefers internal URL and sends key, no-store, timeout, and redirect protection", async () => {
  const { api, calls } = mockApi([regionResponse(), productResponse()])
  const resolved = await api.resolveRegion()
  assert.deepEqual(resolved, region)
  const result = await api.listProducts(resolved, 2)
  assert.equal(result.products[0].title, "Shirt")
  for (const call of calls) {
    assert.equal(call.url.origin, "http://backend.internal:9000")
    assert.equal(call.init.headers["x-publishable-api-key"], env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY)
    assert.equal(call.init.cache, "no-store")
    assert.equal(call.init.redirect, "error")
    assert.ok(call.init.signal instanceof AbortSignal)
  }
  const params = calls[1].url.searchParams
  assert.equal(params.get("region_id"), "reg_us")
  assert.equal(params.get("country_code"), "us")
  assert.equal(params.get("limit"), String(PAGE_SIZE))
  assert.equal(params.get("offset"), String(PAGE_SIZE))
  assert.equal(params.get("order"), "id")
  assert.match(params.get("fields"), /variants\.calculated_price/)
  assert.match(params.get("fields"), /\+variants\.inventory_quantity/)
  assert.equal(params.has("status"), false) // Unsupported filter; Store API enforces published status.
})

test("multi-channel keys can select an authorized channel for listing and detail inventory", async () => {
  const calls = []
  const api = createStoreApi({ ...env, MEDUSA_SALES_CHANNEL_ID: " sc_storefront " }, async (url) => {
    const request = new URL(url)
    calls.push(request)
    // Medusa rejects inventory calculation for a multi-channel key without one channel.
    if (request.searchParams.get("sales_channel_id") !== "sc_storefront") {
      return new Response("Inventory availability cannot be calculated in the given context", { status: 400 })
    }
    return Response.json(productResponse())
  })
  assert.equal((await api.listProducts(region)).products[0].id, rawProduct.id)
  assert.equal((await api.getProduct(region, "shirt")).id, rawProduct.id)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].searchParams.has("handle"), false)
  assert.equal(calls[1].searchParams.get("handle"), "shirt")
})

test("single-channel keys need no explicit sales-channel override", async () => {
  for (const channel of [undefined, "", "   "]) {
    const { api, calls } = mockApi([productResponse()], { MEDUSA_SALES_CHANNEL_ID: channel })
    await api.listProducts(region)
    assert.equal(calls[0].url.searchParams.has("sales_channel_id"), false)
  }
})

test("public backend fallback and country normalization", async () => {
  const { api, calls } = mockApi([regionResponse([{ ...rawRegion, countries: [{ iso_2: "US" }] }])], {
    MEDUSA_BACKEND_URL_INTERNAL: " ", NEXT_PUBLIC_DEFAULT_REGION: " US ",
  })
  assert.equal((await api.resolveRegion()).id, "reg_us")
  assert.equal(calls[0].url.origin, "https://public.example.com")
})

test("region resolution scans later pages instead of picking the first region or assuming a region ID", async () => {
  const others = Array.from({ length: 100 }, (_, index) => ({ ...rawRegion, id: `reg_${index}`, countries: [{ iso_2: "ca" }] }))
  const { api, calls } = mockApi([regionResponse(others, 101), regionResponse()])
  assert.deepEqual(await api.resolveRegion(), region)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.searchParams.get("offset"), "100")
})

test("missing regions and unmatched countries are setup failures, not an empty catalog", async () => {
  for (const response of [regionResponse([]), regionResponse([{ ...rawRegion, countries: [{ iso_2: "ca" }] }])]) {
    const { api } = mockApi([response])
    await assert.rejects(api.resolveRegion(), hasKind("region"))
  }
  const { api } = mockApi([productResponse([])])
  assert.deepEqual(await api.listProducts(region), { products: [], count: 0 })
})

test("handle lookup is encoded in the query and only successful empty lookup is not-found", async () => {
  const handle = "snow/雪 &?#"
  const { api, calls } = mockApi([productResponse([{ ...rawProduct, handle }]), productResponse([])])
  assert.equal((await api.getProduct(region, handle)).handle, handle)
  assert.equal(calls[0].url.pathname, "/store/products")
  assert.equal(calls[0].url.searchParams.get("handle"), handle)
  assert.equal(calls[0].url.searchParams.get("limit"), "1")
  assert.equal(await api.getProduct(region, "absent"), null)
})

for (const status of [400, 401, 403, 404, 429, 500, 503]) {
  test(`HTTP ${status} remains an error, never empty catalog or product-not-found`, async () => {
    const { api } = mockApi([new Response("secret backend response", { status })])
    await assert.rejects(api.getProduct(region, "shirt"), hasKind([401, 403].includes(status) ? "configuration" : "backend"))
  })
}

for (const failure of [new Error("http://internal-host:9000?token=secret"), new DOMException("timed out", "TimeoutError"),
  new Response("not JSON", { status: 200 }), Response.json(null), Response.json({ products: "bad", count: 0 }),
  Response.json({ products: [], count: -1 }), Response.json({ products: [], count: "0" }),
  Response.json(productResponse([{ ...rawProduct, variants: "bad" }])),
  Response.json(productResponse([{ ...rawProduct, status: "draft" }])),
  Response.json(productResponse([{ ...rawProduct, handle: "unexpected" }])),
]) {
  test(`network, malformed, draft, or mismatched product response is safe: ${failure.constructor.name}`, async () => {
    const { api } = mockApi([failure])
    await assert.rejects(api.getProduct(region, "shirt"), (error) => {
      assert.equal(error.kind, "backend")
      assert.equal(error.message, "backend")
      assert.doesNotMatch(JSON.stringify(catalogErrorMessage(error)), /internal-host|token|secret/)
      return true
    })
  })
}

test("region malformed response and request bounds fail safely", async () => {
  for (const value of [{ regions: [], count: 5 }, { regions: [{ id: "bad" }], count: 1 }, { regions: [], count: "0" }]) {
    const { api } = mockApi([value])
    await assert.rejects(api.resolveRegion(), hasKind("backend"))
  }
  const { api, calls } = mockApi([])
  for (const page of [0, -1, 1.5, Infinity, 10001]) await assert.rejects(api.listProducts(region, page), hasKind("backend"))
  assert.equal(calls.length, 0)
})

test("projection preserves major-unit price and text, removes unsafe images and all arbitrary metadata", () => {
  const product = toProduct(rawProduct, "usd")
  assert.equal(product.variants[0].price.amount, 19.99)
  assert.equal(product.description, "<script>alert(1)</script>") // Rendered as React text, never HTML.
  assert.deepEqual(product.images, ["https://images.example.com/shirt.jpg"])
  assert.deepEqual(product.options, [{ id: "opt_size", title: "Size", values: ["S"] }])
  assert.equal(product.collection, "Basics")
  assert.doesNotMatch(JSON.stringify(product), /never-serialize|metadata|original_amount/)
})

test("missing prices, foreign currency, absent variants/images/options, and unknown inventory are not fabricated", () => {
  for (const calculated_price of [null, undefined, { calculated_amount: null, currency_code: "usd" },
    { calculated_amount: 2, currency_code: "eur" }, { calculated_amount: NaN, currency_code: "usd" }]) {
    const product = toProduct({ ...rawProduct, variants: [{ ...rawProduct.variants[0], calculated_price, inventory_quantity: undefined }] }, "usd")
    assert.equal(product.variants[0].price, null)
    assert.equal(product.variants[0].inventoryQuantity, null)
  }
  const product = toProduct({ ...rawProduct, variants: null, options: null, images: null, thumbnail: null }, "usd")
  assert.deepEqual(product.variants, [])
  assert.deepEqual(product.options, [])
  assert.deepEqual(product.images, [])
})

test("declared option values are merged with actual variant values using option IDs", () => {
  const product = toProduct({ ...rawProduct, options: [{ id: "opt_size", title: "Size", values: [{ value: "M" }] }] }, "usd")
  assert.deepEqual(product.options[0].values, ["M", "S"])
})

test("error UI distinguishes connection setup, region setup, and backend failures without diagnostic leakage", () => {
  assert.equal(catalogErrorMessage(new CatalogError("configuration")).title, "Store setup required")
  assert.equal(catalogErrorMessage(new CatalogError("region")).title, "Shopping region unavailable")
  assert.equal(catalogErrorMessage(new CatalogError("backend")).title, "Catalog temporarily unavailable")
  assert.deepEqual(catalogErrorMessage(new Error("private.endpoint:9000 / key secret")), catalogErrorMessage(new CatalogError("backend")))
})
