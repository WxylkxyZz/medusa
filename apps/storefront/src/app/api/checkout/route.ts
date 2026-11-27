import { revalidatePath } from "next/cache"
import { CheckoutError, checkoutErrorMessage, checkoutErrorStatus, validateCheckoutMutation } from "@/lib/checkout"
import { verifyCartOrigin } from "@/lib/cart-policy"
import { getCheckoutService, runtimeBaseUrl, safeCheckoutError } from "@/lib/checkout-server"

export const dynamic = "force-dynamic"

async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new CheckoutError("input")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 8192) { await reader.cancel(); throw new CheckoutError("input") }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch (error) {
    if (error instanceof CheckoutError) throw error
    throw new CheckoutError("input")
  }
}

const messages = {
  "update-address": "Shipping address saved. Checkout refreshed.",
  "list-shipping-options": "Shipping options refreshed.",
  "select-shipping": "Shipping method saved. Checkout refreshed.",
} as const

function verifyCheckoutOrigin(request: Request) {
  try {
    return verifyCartOrigin(request.headers, runtimeBaseUrl())
  } catch (error) {
    // Keep the checkout route's error domain independent from the shared cart
    // policy so every origin failure is rendered as a 403, including callers
    // that provide their own safe-error adapter.
    if (error && typeof error === "object" && "kind" in error) {
      const kind = (error as { kind?: unknown }).kind
      if (kind === "origin" || kind === "configuration") throw new CheckoutError(kind)
    }
    throw error
  }
}

export async function POST(request: Request) {
  const responseHeaders = { "Cache-Control": "no-store" }
  try {
    verifyCheckoutOrigin(request)
    const input = validateCheckoutMutation(await readInput(request))
    await (await getCheckoutService()).mutate(input)
    if (input.action !== "list-shipping-options") {
      revalidatePath("/checkout")
      revalidatePath("/cart")
    }
    return Response.json({ ok: true, message: messages[input.action] }, { headers: responseHeaders })
  } catch (error) {
    const safe = safeCheckoutError(error)
    return Response.json({ ok: false, message: checkoutErrorMessage(safe), uncertain: safe.kind === "uncertain" }, {
      status: checkoutErrorStatus(safe),
      headers: responseHeaders,
    })
  }
}
