import type { CartMutation, MutationResult } from "./cart.ts"

// One origin-wide lock covers every cart control and tab, including reset. In
// particular, two first additions must not create carts and race Set-Cookie.
// Do not queue captured quantities from stale tabs, and never retry a write.
export async function sendCartMutation(input: CartMutation, locks: Pick<LockManager, "request"> | undefined, fetcher: typeof fetch = fetch): Promise<MutationResult> {
  if (!locks) return { ok: false, message: "Cart changes require a browser with Web Locks support on a secure connection (or localhost). No change was sent." }
  return locks.request("medusa-guest-cart-mutation", { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return { ok: false, message: "Another tab is updating your cart. Check your cart after it finishes before trying again. No change was sent." }
    const response = await fetcher("/api/cart", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    })
    const data: unknown = await response.json()
    if (!data || typeof data !== "object" || !("ok" in data) || typeof data.ok !== "boolean" || !("message" in data) || typeof data.message !== "string" || (data.ok && !response.ok)) throw new Error("Unconfirmed cart response")
    return { ok: data.ok, message: data.message, uncertain: "uncertain" in data && data.uncertain === true }
  })
}
