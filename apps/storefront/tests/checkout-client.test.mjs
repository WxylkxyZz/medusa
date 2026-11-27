import test from "node:test"
import assert from "node:assert/strict"
import { CHECKOUT_MUTATION_LOCK, sendCheckoutMutation } from "../src/lib/checkout-client.ts"

const input = { action: "select-shipping", optionId: "so_standard" }
function locks() {
  return {
    async request(name, options, callback) {
      assert.equal(name, CHECKOUT_MUTATION_LOCK)
      assert.equal(name, "medusa-guest-cart-mutation")
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true })
      return callback({ name })
    },
  }
}

test("checkout writes use same-origin credentials, strict JSON, shared lock, and no retry", async () => {
  let calls = 0
  const result = await sendCheckoutMutation(input, locks(), async (url, init) => {
    calls++
    assert.equal(url, "/api/checkout")
    assert.equal(init.method, "POST")
    assert.equal(init.credentials, "same-origin")
    assert.equal(init.cache, "no-store")
    assert.equal(init.headers["Content-Type"], "application/json")
    assert.deepEqual(JSON.parse(init.body), input)
    return Response.json({ ok: true, message: "Shipping method saved." })
  })
  assert.deepEqual(result, { ok: true, message: "Shipping method saved.", uncertain: false })
  assert.equal(calls, 1)
})

test("checkout mutation fails closed without Web Locks and never queues a second pending write", async () => {
  let calls = 0
  assert.equal((await sendCheckoutMutation(input, undefined, async () => { calls++; throw new Error() })).ok, false)
  assert.equal(calls, 0)
  let release
  const held = {
    async request(_name, _options, callback) {
      if (release) return callback(null)
      return callback({ name: CHECKOUT_MUTATION_LOCK })
    },
  }
  const first = sendCheckoutMutation(input, held, async () => {
    await new Promise((resolve) => { release = resolve })
    return Response.json({ ok: true, message: "Saved" })
  })
  const second = await sendCheckoutMutation(input, { request: async (_name, _options, callback) => callback(null) }, async () => {
    calls++
    return Response.json({ ok: true, message: "Should not send" })
  })
  assert.equal(second.ok, false)
  release()
  assert.equal((await first).ok, true)
  assert.equal(calls, 0)
})

test("checkout writes do not retry malformed or uncertain responses", async () => {
  for (const failure of [new Error("network"), new Response("not json"), Response.json({ ok: true, message: "bad" }, { status: 503 }), Response.json({ error: "private" }), Response.json({ ok: false, message: "bad", uncertain: "yes" })]) {
    let calls = 0
    await assert.rejects(sendCheckoutMutation(input, locks(), async () => { calls++; if (failure instanceof Error) throw failure; return failure }))
    assert.equal(calls, 1)
  }
})
