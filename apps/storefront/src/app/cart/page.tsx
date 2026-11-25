import type { Metadata } from "next"
import Link from "next/link"
import CartContents, { ResetCart } from "@/components/cart-contents"
import StoreLayout from "../store/layout"
import { CartError, cartErrorMessage } from "@/lib/cart"
import { getCartService, safeCartError } from "@/lib/cart-server"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Your cart | B2C Store", robots: { index: false, follow: false } }
export default async function CartPage() {
  let state
  try { state = await (await getCartService()).read() } catch (error) {
    return <StoreLayout><section className="notice">
      <h1>Cart unavailable</h1>
      <p role="alert">{cartErrorMessage(safeCartError(error))}</p>
      <a className="button" href="/cart">Try loading cart again</a>
      <ResetCart />
      <p><Link href="/store">Continue browsing</Link></p>
    </section></StoreLayout>
  }
  return <StoreLayout>
    <header className="catalog-heading"><h1>Your cart</h1><p>Review items and estimated prices. This is not an order.</p></header>
    {state.issue ? <section className="notice">
      <h2>Saved cart needs attention</h2>
      <p role="alert">{cartErrorMessage(new CartError(state.issue))}</p>
      <ResetCart />
      <p><Link href="/store">Back to products</Link></p>
    </section> : <CartContents cart={state.cart} />}
  </StoreLayout>
}
