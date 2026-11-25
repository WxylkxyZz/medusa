import { revalidatePath } from "next/cache"
import { CartError, cartErrorMessage, validateMutation } from "@/lib/cart"
import { verifyCartOrigin } from "@/lib/cart-policy"
import { getCartCookie, getCartService, runtimeBaseUrl, safeCartError } from "@/lib/cart-server"

export const dynamic = "force-dynamic"

async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new CartError("input")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 4096) { await reader.cancel(); throw new CartError("input") }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch { throw new CartError("input") }
}

export async function POST(request: Request) {
  const responseHeaders = { "Cache-Control": "no-store" }
  try {
    verifyCartOrigin(request.headers, runtimeBaseUrl())
    const input = validateMutation(await readInput(request))
    if (input.action === "reset") {
      // Reset remains available even when the backend/region is unavailable.
      ;(await getCartCookie()).clear()
    } else {
      await (await getCartService()).mutate(input)
    }
    revalidatePath("/cart")
    return Response.json({ ok: true, message: input.action === "add" ? "Item added to your cart." : input.action === "reset" ? "Saved cart reset. You can start a new cart from the catalog." : input.action === "remove" ? "Item removed." : "Quantity updated." }, { headers: responseHeaders })
  } catch (error) {
    const safe = safeCartError(error)
    return Response.json({ ok: false, message: cartErrorMessage(safe), uncertain: safe.kind === "uncertain" }, {
      status: safe.kind === "origin" ? 403 : safe.kind === "input" ? 400 : ["backend", "configuration", "uncertain"].includes(safe.kind) ? 503 : 409,
      headers: responseHeaders,
    })
  }
}
