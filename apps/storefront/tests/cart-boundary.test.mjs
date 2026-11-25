import test from "node:test"
import assert from "node:assert/strict"
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as jsxRuntime from "react/jsx-runtime"
import { inlineStaticEnv } from "next/dist/lib/inline-static-env.js"
import * as cart from "../src/lib/cart.ts"
import * as policy from "../src/lib/cart-policy.ts"

async function compile(file) {
  return ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
}
const base = "http://localhost:8000"
async function routeContext() {
  const mutations = [], invalidations = []
  let resets = 0, serviceGets = 0, failure
  const exports = {}
  vm.runInNewContext(await compile("../src/app/api/cart/route.ts"), {
    exports, Response, Buffer,
    require(name) {
      if (name === "next/cache") return { revalidatePath: (path) => invalidations.push(path) }
      if (name === "@/lib/cart") return cart
      if (name === "@/lib/cart-policy") return policy
      if (name === "@/lib/cart-server") return {
        runtimeBaseUrl: () => base,
        getCartCookie: async () => ({ clear: () => resets++ }),
        getCartService: async () => {
          serviceGets++
          if (failure) throw failure
          return { mutate: async (input) => mutations.push(input) }
        },
        safeCartError: (error) => error instanceof cart.CartError ? error : new cart.CartError("backend"),
      }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  return {
    post: exports.POST, mutations, invalidations, resets: () => resets, serviceGets: () => serviceGets,
    fail: (error) => { failure = error },
  }
}
function request(input, headers = {}) {
  return new Request(`${base}/api/cart`, { method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof input === "string" ? input : JSON.stringify(input) })
}

test("real route validates same-origin input, responds only with safe status and invalidates cart after success", async () => {
  const ctx = await routeContext()
  const response = await ctx.post(request({ action: "add", handle: "shirt", variantId: "variant_one", quantity: 1 }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const data = await response.json()
  assert.deepEqual(data, { ok: true, message: "Item added to your cart." })
  assert.doesNotMatch(JSON.stringify(data), /variant_one|pk_|cart_secret|backend.internal/)
  assert.equal(ctx.mutations.length, 1)
  assert.deepEqual(ctx.invalidations, ["/cart"])
})

test("real route rejects bad origins, fields, malformed JSON and oversized bodies before service invocation", async () => {
  const ctx = await routeContext()
  for (const [input, headers, status] of [
    [{ action: "reset" }, { origin: "https://evil.example", host: "localhost:8000" }, 403],
    [{ action: "reset" }, { origin: "" }, 403],
    [{ action: "reset" }, { "content-type": "text/plain" }, 403],
    [{ action: "reset", cartId: "foreign" }, {}, 400],
    [{ action: "update", lineId: "cali_one", quantity: 1.5 }, {}, 400],
    ["{", {}, 400],
    [" ".repeat(4097), {}, 400],
  ]) {
    const response = await ctx.post(request(input, headers))
    assert.equal(response.status, status)
    assert.equal((await response.json()).ok, false)
  }
  assert.equal(ctx.serviceGets(), 0)
  assert.equal(ctx.resets(), 0)
  assert.deepEqual(ctx.invalidations, [])
})

test("reset route only clears local cookie even when backend/configured region is down", async () => {
  const ctx = await routeContext()
  ctx.fail(new Error("private backend diagnostic"))
  const response = await ctx.post(request({ action: "reset" }))
  assert.equal(response.status, 200)
  assert.equal(ctx.resets(), 1)
  assert.equal(ctx.serviceGets(), 0)
  assert.deepEqual(ctx.invalidations, ["/cart"])
})

test("real route maps uncertain/stock/configuration failures without leaking errors or retrying writes", async () => {
  const ctx = await routeContext()
  for (const [error, status] of [[new cart.CartError("uncertain"), 503], [new cart.CartError("stock"), 409], [new cart.CartError("configuration"), 503], [new Error("pk_SECRET http://backend.internal"), 503]]) {
    ctx.fail(error)
    const response = await ctx.post(request({ action: "remove", lineId: "cali_one" }))
    assert.equal(response.status, status)
    const data = await response.json()
    assert.equal(data.uncertain, error instanceof cart.CartError && error.kind === "uncertain")
    assert.doesNotMatch(JSON.stringify(data), /pk_SECRET|backend.internal/)
  }
  assert.equal(ctx.serviceGets(), 4)
  assert.deepEqual(ctx.invalidations, [])
})

test("cart page exposes local reset when backend or region setup fails", async () => {
  for (const kind of ["backend", "configuration"]) {
    const exports = {}
    vm.runInNewContext(await compile("../src/app/cart/page.tsx"), {
      exports,
      require(name) {
        if (name === "react/jsx-runtime") return jsxRuntime
        if (name === "next/link") return { default: ({ children, href }) => createElement("a", { href }, children) }
        if (name === "../store/layout") return { default: ({ children }) => createElement("main", null, children) }
        if (name === "@/components/cart-contents") return {
          default: () => createElement("div", null, "Cart contents"),
          ResetCart: () => createElement("button", null, "Reset saved cart"),
        }
        if (name === "@/lib/cart") return cart
        if (name === "@/lib/cart-server") return {
          getCartService: async () => { throw new cart.CartError(kind) },
          safeCartError: (error) => error,
        }
        throw new Error(`Unexpected import ${name}`)
      },
    })
    const html = renderToStaticMarkup(await exports.default())
    assert.match(html, /Cart unavailable/)
    assert.match(html, /Reset saved cart/)
    assert.match(html, /Try loading cart again/)
  }
})

test("cart runtime base URL survives Next inlining and actual server cookie adapter uses safe set/clear attributes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cart-runtime-"))
  const name = "NEXT_PUBLIC_BASE_URL", previous = process.env[name]
  try {
    process.env[name] = "https://build-placeholder.example.com"
    await mkdir(join(directory, "server"))
    await mkdir(join(directory, "static"))
    const output = join(directory, "server", "cart.js")
    await writeFile(output, await compile("../src/lib/cart-server.ts"))
    await inlineStaticEnv({ distDir: directory, config: { env: {} } })
    const processed = await readFile(output, "utf8")
    assert.ok(!processed.includes("build-placeholder"))
    const runtime = { NEXT_PUBLIC_BASE_URL: base, NODE_ENV: "production" }
    const calls = [], exports = {}
    vm.runInNewContext(processed, {
      exports, process: { env: runtime },
      require(name) {
        if (name === "server-only") return {}
        if (name === "next/headers") return { cookies: async () => ({ get: () => ({ value: "cart_offline" }), set: (...args) => calls.push(args) }) }
        if (name === "./cart") return cart
        if (name === "./cart-policy") return policy
        if (["./cart-api", "./cart-service", "./store-api", "./store"].includes(name)) return {}
        throw new Error(`Unexpected import ${name}`)
      },
    })
    assert.equal(exports.runtimeBaseUrl(), base)
    const cookie = await exports.getCartCookie()
    assert.equal(cookie.read(), "cart_offline")
    cookie.save("cart_new")
    cookie.clear()
    assert.deepEqual(calls.map(([name, value, options]) => [name, value, options.secure, options.httpOnly, options.sameSite, options.path, options.maxAge]), [
      [policy.CART_COOKIE, "cart_new", false, true, "lax", "/", 2592000], [policy.CART_COOKIE, "", false, true, "lax", "/", 0],
    ])
    runtime.NEXT_PUBLIC_BASE_URL = "https://runtime.example.com"
    const secureCookie = await exports.getCartCookie()
    secureCookie.save("cart_https")
    secureCookie.clear()
    assert.equal(calls[2][2].secure, true)
    assert.equal(calls[3][2].secure, true)
    assert.equal(calls[3][2].maxAge, 0)
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
    await rm(directory, { recursive: true, force: true })
  }
})
