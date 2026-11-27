import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import ts from "typescript"
import * as checkout from "../src/lib/checkout.ts"
import * as policy from "../src/lib/cart-policy.ts"

async function compile(file) {
  return ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
}
const base = "http://localhost:8000"
async function routeContext() {
  const mutations = [], invalidations = []
  let serviceCalls = 0, failure
  const exports = {}
  vm.runInNewContext(await compile("../src/app/api/checkout/route.ts"), {
    exports, Response, Buffer,
    require(name) {
      if (name === "next/cache") return { revalidatePath: (path) => invalidations.push(path) }
      if (name === "@/lib/checkout") return checkout
      if (name === "@/lib/cart-policy") return policy
      if (name === "@/lib/checkout-server") return {
        runtimeBaseUrl: () => base,
        getCheckoutService: async () => {
          serviceCalls++
          if (failure) throw failure
          return { mutate: async (input) => mutations.push(input) }
        },
        safeCheckoutError: (error) => error instanceof checkout.CheckoutError ? error : new checkout.CheckoutError("backend"),
      }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  return { post: exports.POST, mutations, invalidations, serviceCalls: () => serviceCalls, fail: (error) => { failure = error } }
}
function request(input, headers = {}) {
  return new Request(`${base}/api/checkout`, { method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof input === "string" ? input : JSON.stringify(input) })
}
const address = { firstName: "Ada", lastName: "Lovelace", address1: "1 Main St", city: "London", postalCode: "12345", countryCode: "us" }

test("checkout route guards exact origin, strict JSON actions, safe response, and revalidates both views after writes", async () => {
  const ctx = await routeContext()
  const response = await ctx.post(request({ action: "update-address", address, useSameBilling: true }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.deepEqual(body, { ok: true, message: "Shipping address saved. Checkout refreshed." })
  assert.doesNotMatch(JSON.stringify(body), /cart_secret|payment_collection|pk_|backend.internal/)
  assert.deepEqual(ctx.mutations, [{ action: "update-address", address, useSameBilling: true }])
  assert.deepEqual(ctx.invalidations, ["/checkout", "/cart"])
})

test("checkout route rejects cross-origin, wrong content type, unknown fields, malformed JSON, and oversized bodies before service", async () => {
  const ctx = await routeContext()
  for (const [input, headers, status] of [
    [{ action: "list-shipping-options" }, { origin: "https://evil.example" }, 403],
    [{ action: "list-shipping-options" }, { "content-type": "text/plain" }, 403],
    [{ action: "list-shipping-options", cartId: "cart_secret" }, {}, 400],
    [{ action: "select-shipping", optionId: "../foreign" }, {}, 400],
    [{ action: "update-address", address: { ...address, firstName: "" }, useSameBilling: true }, {}, 400],
    [{ action: "update-address", address: { ...address, phone: "x".repeat(41) }, useSameBilling: true }, {}, 400],
    ["{", {}, 400],
    [" ".repeat(8193), {}, 400],
  ]) {
    const response = await ctx.post(request(input, headers))
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.doesNotMatch(JSON.stringify(body), /cart_secret|backend.internal|pk_|private/)
  }
  assert.equal(ctx.serviceCalls(), 0)
  assert.deepEqual(ctx.mutations, [])
  assert.deepEqual(ctx.invalidations, [])
})

test("checkout route maps uncertain and backend failures without leaking diagnostics or retrying", async () => {
  const ctx = await routeContext()
  ctx.fail(new checkout.CheckoutError("uncertain"))
  const uncertain = await ctx.post(request({ action: "select-shipping", optionId: "so_standard" }))
  assert.equal(uncertain.status, 503)
  assert.deepEqual(await uncertain.json(), { ok: false, message: checkout.checkoutErrorMessage(new checkout.CheckoutError("uncertain")), uncertain: true })
  ctx.fail(new Error("private token backend.internal"))
  const backend = await ctx.post(request({ action: "list-shipping-options" }))
  assert.equal(backend.status, 503)
  const data = await backend.json()
  assert.equal(data.uncertain, false)
  assert.doesNotMatch(JSON.stringify(data), /private|token|backend.internal/)
})
