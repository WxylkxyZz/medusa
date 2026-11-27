"use client"

import Link from "next/link"
import { formatPrice, productHref } from "@/lib/catalog"
import { MAX_QUANTITY } from "@/lib/cart"
import type { Cart } from "@/lib/cart"
import ProductImage from "./product-image"
import { CartFeedback, useCartMutation } from "./cart-mutation"

export function ResetCart() {
  const { mutate, pending, result } = useCartMutation()
  return <div>
    <p>Reset only forgets this browser’s saved cart. It does not delete the original cart or any orders. Items will not be transferred.</p>
    <button className="button" disabled={pending || result?.uncertain} onClick={() => void mutate({ action: "reset" })}>Reset saved cart</button>
    <CartFeedback pending={pending} result={result} />
  </div>
}
export default function CartContents({ cart }: { cart: Cart | null }) {
  const { mutate, pending, result } = useCartMutation()
  const disabled = pending || result?.uncertain
  if (!cart?.lines.length) return <section className="notice">
    <CartFeedback pending={pending} result={result} />
    <h2>Your cart is empty</h2>
    <p>Choose an available product option to start shopping.</p>
    <Link className="button" href="/store">Browse products</Link>
  </section>
  return <>
    <CartFeedback pending={pending} result={result} />
    <ul className="cart-lines" aria-label="Cart items" aria-busy={pending}>
      {cart.lines.map((line) => <li className="cart-line" key={line.id}>
        <div className="cart-thumbnail"><ProductImage src={line.thumbnail ?? undefined} alt={line.title} /></div>
        <div>
          <h2>{line.handle ? <Link href={productHref(line.handle)}>{line.title}</Link> : line.title}</h2>
          {line.variantTitle && <p className="muted">{line.variantTitle}</p>}
          <p>Unit price: {formatPrice(line.unitPrice)}{line.taxInclusive === true ? " (tax inclusive)" : line.taxInclusive === false ? " (before tax)" : ""}</p>
          <p>Line subtotal: {formatPrice(line.subtotal)}</p>
          <p className="price">Estimated line total: {formatPrice(line.total)}</p>
          <div className="cart-controls">
            <form onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void mutate({ action: "update", lineId: line.id, quantity: Number(form.get("quantity")) })
            }}>
              <label htmlFor={`qty-${line.id}`}>Quantity<span className="sr-only"> for {line.title} {line.variantTitle}</span></label>
              <input key={`${line.id}-${line.quantity}`} id={`qty-${line.id}`} name="quantity" type="number" min={1} max={MAX_QUANTITY} step={1} required defaultValue={line.quantity} disabled={disabled} />
              <button type="submit" disabled={disabled}>Update<span className="sr-only"> quantity for {line.title} {line.variantTitle}</span></button>
            </form>
            <button type="button" disabled={disabled} onClick={() => void mutate({ action: "remove", lineId: line.id })}>Remove<span className="sr-only"> {line.title} {line.variantTitle}</span></button>
          </div>
        </div>
      </li>)}
    </ul>
    <section className="cart-summary notice" aria-labelledby="cart-totals">
      <h2 id="cart-totals">Estimated totals ({cart.currencyCode.toUpperCase()})</h2>
      <dl>
        <dt>Items subtotal (before tax)</dt><dd>{formatPrice(cart.itemSubtotal)}</dd>
        {cart.discountTotal && <><dt>Discounts reported by store</dt><dd>{formatPrice(cart.discountTotal)}</dd></>}
        {cart.taxTotal && <><dt>Estimated tax</dt><dd>{formatPrice(cart.taxTotal)}</dd></>}
        <dt>Estimated total reported by store</dt><dd className="price">{formatPrice(cart.total)}</dd>
      </dl>
      <p className="muted small">These are Medusa’s current cart estimates, not a final purchase quote. The items subtotal excludes shipping; a shipping method is only chosen at checkout, and no free shipping is promised. Tax and availability may change. Checkout and payment are not available.</p>
    </section>
    <p><Link href="/checkout" className="button">Continue to checkout</Link></p>
    <p><Link href="/store">Continue shopping</Link></p>
  </>
}
