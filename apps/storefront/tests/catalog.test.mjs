import test from "node:test"
import assert from "node:assert/strict"
import {
  availability, formatPrice, initialSelection, matchingVariants, parsePage,
  productHref, productPrice, safeImageUrl, PAGE_SIZE, MAX_PAGE,
} from "../src/lib/catalog.ts"

const options = [
  { id: "color", title: "Color", values: ["Red", "Blue"] },
  { id: "size", title: "Size", values: ["S", "M"] },
]
const variant = (id, color, size, extra = {}) => ({
  id, title: id, sku: null, options: [{ optionId: "color", value: color }, { optionId: "size", value: size }],
  price: { amount: 19.99, currencyCode: "usd" }, manageInventory: true, allowBackorder: false, inventoryQuantity: 2,
  ...extra,
})
const variants = [variant("red-small", "Red", "S"), variant("blue-medium", "Blue", "M")]

test("Medusa v2 amounts remain in major units, including zero and zero/three-decimal currencies", () => {
  assert.equal(formatPrice({ amount: 19.99, currencyCode: "usd" }), "$19.99")
  assert.equal(formatPrice({ amount: 0, currencyCode: "USD" }), "$0.00")
  assert.equal(formatPrice({ amount: 1200, currencyCode: "jpy" }), "¥1,200")
  assert.match(formatPrice({ amount: 1.234, currencyCode: "kwd" }), /1\.234/)
  for (const price of [null, { amount: NaN, currencyCode: "usd" }, { amount: Infinity, currencyCode: "usd" },
    { amount: -1, currencyCode: "usd" }, { amount: 10, currencyCode: "bad-code" }]) {
    assert.equal(formatPrice(price), "Price unavailable")
  }
})

test("product price summarizes real variant prices, not original/raw prices", () => {
  assert.equal(productPrice({ variants }), "$19.99")
  assert.equal(productPrice({ variants: [...variants, variant("cheap", "Red", "M", { price: { amount: 10, currencyCode: "usd" } })] }), "From $10.00")
  assert.equal(productPrice({ variants: [variants[0], { ...variants[1], price: null }] }), "From $19.99")
  assert.equal(productPrice({ variants: [] }), "Price unavailable")
  assert.equal(productPrice({ variants: [{ price: null }] }), "Price unavailable")
})

test("selection must exactly match option IDs and all chosen values", () => {
  assert.deepEqual(initialSelection(options, variants), {})
  assert.deepEqual(initialSelection(options, [variants[0]]), { color: "Red", size: "S" })
  assert.deepEqual(matchingVariants(options, variants, { color: "Red" }), [])
  assert.deepEqual(matchingVariants(options, variants, { color: "Red", size: "M" }), [])
  assert.deepEqual(matchingVariants(options, variants, { color: "Blue", size: "M" }), [variants[1]])
  assert.deepEqual(matchingVariants([], [variants[0]], {}), [variants[0]])
  assert.deepEqual(matchingVariants([], variants, {}), variants) // Explicit fallback variant selector.
  assert.deepEqual(matchingVariants(options, [], { color: "Red", size: "S" }), [])
})

test("availability respects Medusa inventory management, quantities, backorders, and unknown inventory", () => {
  const cases = [
    [{ manageInventory: false, inventoryQuantity: 0 }, "In stock"],
    [{ inventoryQuantity: 1 }, "In stock"],
    [{ inventoryQuantity: 0 }, "Out of stock"],
    [{ inventoryQuantity: -2 }, "Out of stock"],
    [{ inventoryQuantity: 0.5 }, "Out of stock"],
    [{ inventoryQuantity: 0, allowBackorder: true }, "Available on backorder"],
    [{ inventoryQuantity: null, allowBackorder: true }, "Available on backorder"],
    [{ inventoryQuantity: null }, "Availability unavailable"],
    [{ inventoryQuantity: NaN }, "Availability unavailable"],
    [{ manageInventory: null }, "Availability unavailable"],
  ]
  for (const [extra, expected] of cases) assert.equal(availability({ ...variants[0], ...extra }), expected)
  assert.equal(availability(undefined), "Select a variant to see availability")
})

test("image URLs reject executable, protocol-relative, credential-bearing, whitespace, and malformed sources", () => {
  for (const value of [null, "", "/uploads/image.png", "//example.com/a.png", "javascript:alert(1)",
    "data:image/svg+xml,test", "file:///etc/passwd", "https://user:password@example.com/a.png", "https://example.com/\na.png", "https://exa mple.com/a.png"]) {
    assert.equal(safeImageUrl(value), null)
  }
  assert.equal(safeImageUrl("https://example.com/photo.png"), "https://example.com/photo.png")
  assert.equal(safeImageUrl("http://localhost:9000/static/a.png"), "http://localhost:9000/static/a.png")
})

test("detail links and pagination safely bound untrusted route input", () => {
  assert.equal(productHref("a/b ?#雪"), "/store/a%2Fb%20%3F%23%E9%9B%AA")
  assert.equal(productHref(".."), "/store")
  assert.equal(productHref("."), "/store")
  assert.equal(PAGE_SIZE, 12)
  for (const input of [undefined, ["2"], "0", "-1", "1.5", "1e3", "002", "Infinity", "9999999999999999999999", String(MAX_PAGE + 1)]) {
    assert.equal(parsePage(input), 1)
  }
  assert.equal(parsePage("2"), 2)
  assert.equal(parsePage(String(MAX_PAGE)), MAX_PAGE)
})
