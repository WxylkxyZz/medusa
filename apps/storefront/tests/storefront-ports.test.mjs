import test from "node:test"
import assert from "node:assert/strict"
import { resolveSiteOrigin } from "../src/lib/site-url.ts"
import { buildRobots, sitemapEntries } from "../src/lib/seo.ts"
import { productPageMetadata, productOpenGraphTags, productStructuredData, toJsonLd } from "../src/lib/product-metadata.ts"
import { shippingPolicyState, returnsPolicyState, projectPolicyMetadata } from "../src/lib/policies.ts"

const region = { id: "reg_us", name: "US", currencyCode: "usd", countryCode: "us" }
const product = {
  id: "prod_1", handle: "red shirt", title: "A </script><script>bad", subtitle: null,
  description: "Description <b>text</b>", images: ["https://cdn.example/a.jpg"], options: [], collection: null, material: null,
  variants: [{ id: "var_1", title: "Default", sku: "SKU-1", options: [], price: { amount: 19.99, currencyCode: "usd" }, manageInventory: true, allowBackorder: false, inventoryQuantity: 2 }],
}

test("site URL accepts only a safe runtime origin", () => {
  assert.equal(resolveSiteOrigin("https://shop.example/"), "https://shop.example")
  for (const value of [undefined, "", "https://shop.example/path", "https://user:pass@shop.example", "javascript:bad", "https://shop.example?q=secret"]) {
    assert.equal(resolveSiteOrigin(value), null)
  }
})

test("sitemap has static public routes and encoded product handles without private routes", () => {
  const entries = sitemapEntries("https://shop.example", ["red shirt", "..", "checkout"])
  assert.deepEqual(entries.map((entry) => entry.url), [
    "https://shop.example/", "https://shop.example/store", "https://shop.example/shipping", "https://shop.example/returns",
    "https://shop.example/store/red%20shirt", "https://shop.example/store/checkout",
  ])
  assert.deepEqual(buildRobots("https://shop.example").rules, { userAgent: "*", allow: "/", disallow: ["/cart", "/checkout", "/api/"] })
})

test("JSON-LD escapes markup and contains only calculated price and inventory", () => {
  const data = productStructuredData(product, region, "https://shop.example/store/red%20shirt")
  const json = toJsonLd(data)
  assert.doesNotMatch(json, /<\/?script/i)
  assert.match(json, /19\.99/)
  assert.match(json, /InStock/)
  assert.equal(productOpenGraphTags(product, region).find((tag) => tag.property === "product:price:amount")?.content, "19.99")
  assert.equal(productPageMetadata(product, region, "https://shop.example").other?.["product:price:currency"], "USD")
})

test("missing product or region remains noindex in metadata", () => {
  assert.equal(productPageMetadata(null, null, "https://shop.example").robots?.index, false)
  assert.equal(productPageMetadata(product, region, "https://shop.example").alternates?.canonical, "https://shop.example/store/red%20shirt")
})

test("policy resolver publishes approved USD shipping and explicit missing returns", () => {
  assert.deepEqual(shippingPolicyState(null, "usd"), { status: "published", policy: { rate: { amount: 5, currencyCode: "usd" }, service: "standard", transitDays: { min: 5, max: 7 }, taxInclusive: false } })
  assert.deepEqual(shippingPolicyState(null, "eur"), { status: "not-published", reason: "no-policy" })
  assert.deepEqual(returnsPolicyState(undefined), { status: "not-published", reason: "no-policy" })
  assert.deepEqual(projectPolicyMetadata({ shipping_rate: 5, private_token: "secret" }), { shipping_rate: 5 })
})
