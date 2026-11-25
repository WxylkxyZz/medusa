"use client"

import { useState } from "react"
import Link from "next/link"
import { availability, canPurchase, formatPrice, initialSelection, matchingVariants } from "@/lib/catalog"
import { CartFeedback, useCartMutation } from "./cart-mutation"
import type { ProductOption, Variant } from "@/lib/catalog"

export default function VariantPicker({ handle, options, variants }: { handle: string; options: ProductOption[]; variants: Variant[] }) {
  const { mutate, pending, result } = useCartMutation()
  const [selection, setSelection] = useState(() => initialSelection(options, variants))
  const [explicitVariant, setExplicitVariant] = useState("")
  const matches = matchingVariants(options, variants, selection)
  const variant = matches.length === 1 ? matches[0] : matches.find((entry) => entry.id === explicitVariant)
  const complete = options.every((option) => Boolean(selection[option.id]))

  if (!variants.length) return <p role="status">No variants available for this product.</p>

  return (
    <section className="variant-picker" aria-labelledby="variants-heading">
      <h2 id="variants-heading">Choose options</h2>
      <fieldset disabled={pending} className="cart-fields">
      <legend className="sr-only">Product options</legend>
      {options.map((option) => (
        <div className="option-field" key={option.id}>
          <label htmlFor={`option-${option.id}`}>{option.title}</label>
          <select id={`option-${option.id}`} value={selection[option.id] ?? ""} onChange={(event) => {
            setSelection({ ...selection, [option.id]: event.target.value })
            setExplicitVariant("")
          }}>
            <option value="">Select {option.title.toLowerCase()}</option>
            {option.values.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      ))}
      {matches.length > 1 && (
        <div className="option-field">
          <label htmlFor="variant">Variant</label>
          <select id="variant" value={explicitVariant} onChange={(event) => setExplicitVariant(event.target.value)}>
            <option value="">Select a variant</option>
            {matches.map((entry, index) => <option key={entry.id} value={entry.id}>
              {entry.title}{entry.sku ? ` — ${entry.sku}` : ` (${index + 1})`}
            </option>)}
          </select>
        </div>
      )}
      <div className="variant-status" aria-live="polite" aria-atomic="true">
        {!complete ? <p>Select all options to see price and availability.</p> :
          !matches.length ? <p>This option combination is not available.</p> :
          !variant ? <p>Select a variant to see price and availability.</p> : <>
            <p className="price">{formatPrice(variant.price)}</p>
            <p>{availability(variant)}</p>
            <p className="muted">Variant: {variant.title}</p>
            {variant.sku && <p className="muted">SKU: {variant.sku}</p>}
          </>}
      </div>
      </fieldset>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (complete && canPurchase(variant) && variant) void mutate({ action: "add", handle, variantId: variant.id, quantity: 1 })
      }}>
        <button className="button" type="submit" disabled={pending || result?.uncertain || !complete || !canPurchase(variant)}>
          {pending ? "Adding…" : "Add to cart"}
        </button>
      </form>
      <CartFeedback pending={pending} result={result} />
      <p><Link href="/cart">View cart</Link></p>
      <p className="muted small">Availability may change. Checkout and payment are not available yet.</p>
      <noscript><p>Enable JavaScript to choose product options and view variant availability.</p></noscript>
    </section>
  )
}
