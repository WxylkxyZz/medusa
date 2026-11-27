import type { CheckoutMutation } from "./checkout.ts"
import type { MutationResult } from "./cart.ts"

// Checkout writes use the same origin-wide lock as line-item writes. This
// prevents an address or shipping-method write from racing a cart tab that is
// changing the lines used to calculate the option price.
export const CHECKOUT_MUTATION_LOCK = "medusa-guest-cart-mutation"

export async function sendCheckoutMutation(
  input: CheckoutMutation,
  locks: Pick<LockManager, "request"> | undefined,
  fetcher: typeof fetch = fetch,
): Promise<MutationResult> {
  if (!locks) return { ok: false, message: "Checkout changes require a browser with Web Locks support on a secure connection (or localhost). No change was sent." }
  return locks.request(CHECKOUT_MUTATION_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return { ok: false, message: "Another cart or checkout tab is updating your cart. Check checkout after it finishes before trying again. No change was sent." }
    const response = await fetcher("/api/checkout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    })
    const data: unknown = await response.json()
    if (!data || typeof data !== "object" || !("ok" in data) || typeof data.ok !== "boolean" ||
        !("message" in data) || typeof data.message !== "string" ||
        ("uncertain" in data && typeof data.uncertain !== "boolean") || (data.ok && !response.ok)) throw new Error("Unconfirmed checkout response")
    return { ok: data.ok, message: data.message, uncertain: "uncertain" in data && data.uncertain === true }
  })
}
