import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import ts from "typescript"
import { createElement } from "react"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as jsxRuntime from "react/jsx-runtime"
import * as catalog from "../src/lib/catalog.ts"
import * as cartModule from "../src/lib/cart.ts"
import { toSavedCart } from "../src/lib/cart-api.ts"
import { toSavedCheckoutCart } from "../src/lib/checkout-api.ts"
import { checkoutCartProjection } from "../src/lib/checkout.ts"

async function compile(file) {
  return ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
}

const shared = {
  "next/link": { default: ({ children, href }) => createElement("a", { href }, children) },
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "react": React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/catalog": catalog,
  "@/lib/cart": cartModule,
  "./product-image": { default: ({ alt }) => createElement("span", null, `image: ${alt}`) },
}

async function load(component, extra = {}) {
  const exports = {}
  vm.runInNewContext(await compile(component), {
    exports, require(name) {
      if (Object.hasOwn(extra, name)) return extra[name]
      if (Object.hasOwn(shared, name)) return shared[name]
      throw new Error(`Unexpected import ${name}`)
    },
  })
  return exports.default
}

function summary(html) {
  const start = html.indexOf("checkout-totals")
  assert.ok(start >= 0, "checkout totals list must render")
  const end = html.indexOf("</dl>", start)
  return html.slice(start, end)
}

// A $10 item with an already-selected $5 shipping method. Medusa reports
// item_subtotal 10, shipping_subtotal 5, subtotal 15, total 15 for this cart.
const line = {
  id: "cali_one", variant_id: "variant_one", product_handle: "shirt", product_title: "Shirt", variant_title: "Small",
  quantity: 1, unit_price: 10, subtotal: 10, total: 10, thumbnail: null, is_tax_inclusive: false,
}
const address = { first_name: "Ada", last_name: "Lovelace", address_1: "1 Main St", city: "London", postal_code: "12345", country_code: "us" }
const rawWithShipping = {
  id: "cart_secret", region_id: "reg_us", shipping_address: address, currency_code: "usd", sales_channel_id: "sc_one", completed_at: null,
  items: [line], item_subtotal: 10, shipping_subtotal: 5, shipping_total: 5, subtotal: 15, total: 15, tax_total: 0, discount_total: 0,
  shipping_methods: [{ name: "Standard Shipping", shipping_option_id: "so_standard", amount: 5, is_tax_inclusive: false }],
}
const rawWithoutShipping = { ...rawWithShipping, shipping_subtotal: 0, shipping_total: 0, subtotal: 10, total: 10, shipping_methods: [] }

async function renderCheckout(raw) {
  const CheckoutForm = await load("../src/components/checkout-form.tsx", {
    "@/lib/checkout-client": { sendCheckoutMutation: async () => ({ ok: true, message: "ok" }) },
  })
  const state = { cart: checkoutCartProjection(toSavedCheckoutCart(raw)), shippingOptions: [], shippingState: "available" }
  return renderToStaticMarkup(createElement(CheckoutForm, { state }))
}

test("checkout displays item subtotal $10, shipping $5, and total $15 for a $10 item with $5 shipping", async () => {
  const html = await renderCheckout(rawWithShipping)
  const totals = summary(html)
  assert.match(totals, /Items subtotal \(before tax\)<\/dt><dd>\$10\.00<\/dd>/)
  assert.match(totals, /Shipping reported by store<\/dt><dd>\$5\.00<\/dd>/)
  assert.match(totals, /Estimated total reported by store<\/dt><dd class="price">\$15\.00<\/dd>/)
  assert.doesNotMatch(totals, /<dt>Subtotal<\/dt>/)
  assert.doesNotMatch(totals, /Shipping\/dd>.*?\$15\.00/)
})

test("checkout without a selected shipping method says not selected, not $0.00 or free shipping", async () => {
  const html = await renderCheckout(rawWithoutShipping)
  const totals = summary(html)
  assert.match(totals, /Items subtotal \(before tax\)<\/dt><dd>\$10\.00<\/dd>/)
  assert.match(totals, /<dt>Shipping<\/dt><dd>Not selected<\/dd>/)
  assert.doesNotMatch(totals, /Shipping reported by store/)
  assert.doesNotMatch(totals, /<dt>Shipping reported by store<\/dt><dd>\$0\.00<\/dd>/)
  assert.match(html, /No shipping method is selected; no free shipping is promised\./)
})

test("cart page uses the same item-subtotal label with Medusa's item subtotal, not the shipping-inclusive subtotal", async () => {
  const CartContents = await load("../src/components/cart-contents.tsx", {
    "./cart-mutation": { useCartMutation: () => ({ mutate: async () => {}, pending: false, result: null }), CartFeedback: () => null },
  })
  const cart = toSavedCart(rawWithShipping).cart
  assert.equal(cart.itemSubtotal.amount, 10)
  assert.equal(cart.subtotal.amount, 15) // Guard the fixture: Medusa subtotal includes shipping.
  const html = renderToStaticMarkup(createElement(CartContents, { cart }))
  assert.match(html, /<dt>Items subtotal \(before tax\)<\/dt><dd>\$10\.00<\/dd>/)
  assert.doesNotMatch(html, /Subtotal \(before tax\)<\/dt><dd>\$15\.00/)
})

test("missing item subtotal renders a safe fallback instead of a derived number", async () => {
  const CheckoutForm = await load("../src/components/checkout-form.tsx", {
    "@/lib/checkout-client": { sendCheckoutMutation: async () => ({ ok: true, message: "ok" }) },
  })
  const raw = { ...rawWithShipping, item_subtotal: undefined }
  const saved = toSavedCheckoutCart(raw)
  assert.equal(saved.cart.itemSubtotal, null)
  const html = renderToStaticMarkup(createElement(CheckoutForm, { state: { cart: checkoutCartProjection(saved), shippingOptions: [], shippingState: "available" } }))
  const totals = summary(html)
  assert.match(totals, /Items subtotal \(before tax\)<\/dt><dd>Price unavailable<\/dd>/)
  assert.match(totals, /Shipping reported by store<\/dt><dd>\$5\.00<\/dd>/)
})
