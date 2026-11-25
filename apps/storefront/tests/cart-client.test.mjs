import test from "node:test"
import assert from "node:assert/strict"
import { sendCartMutation } from "../src/lib/cart-client.ts"

const add = { action: "add", handle: "shirt", variantId: "variant_one", quantity: 1 }
function browserLocks() {
  let held = false
  return {
    async request(name, options, callback) {
      assert.equal(name, "medusa-guest-cart-mutation")
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true })
      if (held) return callback(null)
      held = true
      try { return await callback({ name }) } finally { held = false }
    },
  }
}

test("independent tabs cannot race first-cart creation, quantity writes, deletion or reset", async () => {
  for (const competing of [add, { action: "update", lineId: "cali_one", quantity: 2 }, { action: "remove", lineId: "cali_one" }, { action: "reset" }]) {
    const locks = browserLocks()
    let release, requests = 0
    const fetcher = async (url, init) => {
      requests++
      assert.equal(url, "/api/cart")
      assert.equal(init.credentials, "same-origin")
      assert.equal(init.cache, "no-store")
      assert.deepEqual(JSON.parse(init.body), add)
      await new Promise((resolve) => { release = resolve })
      return Response.json({ ok: true, message: "Item added." })
    }
    const first = sendCartMutation(add, locks, fetcher)
    const otherTab = await sendCartMutation(competing, locks, fetcher)
    assert.equal(otherTab.ok, false)
    assert.match(otherTab.message, /Another tab/)
    assert.equal(requests, 1)
    release()
    assert.equal((await first).ok, true)
    assert.equal(requests, 1) // Rejected operations are not queued/replayed.
    let next = 0
    assert.equal((await sendCartMutation(competing, locks, async () => { next++; return Response.json({ ok: true, message: "Saved" }) })).ok, true)
    assert.equal(next, 1)
  }
})

test("browsers without shared locks fail closed without sending a mutation", async () => {
  let calls = 0
  const result = await sendCartMutation(add, undefined, async () => { calls++; throw new Error() })
  assert.equal(calls, 0)
  assert.equal(result.ok, false)
  assert.match(result.message, /Web Locks support/)
  assert.equal(result.uncertain, undefined)
})

test("client writes never retry network, malformed or inconsistent responses", async () => {
  for (const failure of [new Error("network"), new Response("not JSON"), Response.json({ ok: true, message: "bad proxy success" }, { status: 503 }), Response.json({ error: "failure" })]) {
    let calls = 0
    await assert.rejects(sendCartMutation(add, browserLocks(), async () => { calls++; if (failure instanceof Error) throw failure; return failure }))
    assert.equal(calls, 1)
  }
})

test("uncertain server outcomes stay uncertain and ordinary rejections remain explicit", async () => {
  for (const uncertain of [false, true]) {
    const result = await sendCartMutation(add, browserLocks(), async () => Response.json({ ok: false, message: "Check cart", uncertain }, { status: 503 }))
    assert.deepEqual(result, { ok: false, message: "Check cart", uncertain })
  }
})
