import type { Metadata } from "next"
import Link from "next/link"
import CheckoutForm from "@/components/checkout-form"
import { ResetCart } from "@/components/cart-contents"
import StoreLayout from "../store/layout"
import { CheckoutError, checkoutErrorMessage } from "@/lib/checkout"
import { getCheckoutService, safeCheckoutError } from "@/lib/checkout-server"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Checkout foundation | B2C Store", robots: { index: false, follow: false } }

export default async function CheckoutPage() {
  let state
  try { state = await (await getCheckoutService()).read() } catch (error) {
    const safe = safeCheckoutError(error)
    return <StoreLayout><section className="notice">
      <h1>Checkout unavailable</h1>
      <p role="alert">{checkoutErrorMessage(safe)}</p>
      <a className="button" href="/checkout">Try loading checkout again</a>
      <ResetCart />
      <p><Link href="/cart">Back to cart</Link></p>
    </section></StoreLayout>
  }
  if (state.issue) return <StoreLayout><section className="notice">
    <h1>Saved cart needs attention</h1>
    <p role="alert">{checkoutErrorMessage(new CheckoutError(state.issue))}</p>
    <ResetCart />
    <p><Link href="/cart">Back to cart</Link></p>
  </section></StoreLayout>
  if (!state.cart) return <StoreLayout><section className="notice">
    <h1>No active cart</h1>
    <p>Start with an available product before opening checkout.</p>
    <p><Link className="button" href="/store">Browse products</Link></p>
    <p><Link href="/cart">Back to cart</Link></p>
  </section></StoreLayout>
  const cart = state.cart
  if (!cart.lines.length) return <StoreLayout><section className="notice">
    <h1>Your cart is empty</h1>
    <p>Choose an available product option before continuing to checkout.</p>
    <p><Link className="button" href="/store">Browse products</Link></p>
    <p><Link href="/cart">Back to cart</Link></p>
  </section></StoreLayout>
  return <StoreLayout>
    <header className="catalog-heading"><h1>Checkout foundation</h1><p>Save a shipping address and review real shipping options. Payment and order placement are not available.</p></header>
    <CheckoutForm state={{ ...state, cart }} />
  </StoreLayout>
}
