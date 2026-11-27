"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"
import { formatPrice } from "@/lib/catalog"
import type { AddressInput, CheckoutAddress, CheckoutCart, CheckoutState } from "@/lib/checkout"
import type { MutationResult } from "@/lib/cart"
import { sendCheckoutMutation } from "@/lib/checkout-client"
import ProductImage from "./product-image"

const emptyAddress = (address: CheckoutAddress | null) => ({
  firstName: address?.firstName ?? "",
  lastName: address?.lastName ?? "",
  address1: address?.address1 ?? "",
  address2: address?.address2 ?? "",
  city: address?.city ?? "",
  province: address?.province ?? "",
  postalCode: address?.postalCode ?? "",
  countryCode: address?.countryCode ?? "",
  phone: address?.phone ?? "",
  company: address?.company ?? "",
})
type AddressForm = ReturnType<typeof emptyAddress>

export function useCheckoutMutation() {
  const router = useRouter()
  const locked = useRef(false)
  const [sending, setSending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [result, setResult] = useState<MutationResult | null>(null)
  async function mutate(input: Parameters<typeof sendCheckoutMutation>[0]): Promise<MutationResult> {
    if (locked.current || refreshing || result?.uncertain) {
      return { ok: false, message: "Checkout is already updating. Refresh checkout before trying again." }
    }
    locked.current = true
    setSending(true)
    setResult(null)
    try {
      const response = await sendCheckoutMutation(input, typeof navigator === "undefined" ? undefined : navigator.locks)
      setResult(response)
      startTransition(() => { router.refresh() })
      return response
    } catch {
      const response = { ok: false, message: "We could not confirm the checkout change. Refresh checkout before trying again.", uncertain: true }
      setResult(response)
      startTransition(() => { router.refresh() })
      return response
    } finally {
      locked.current = false
      setSending(false)
    }
  }
  return { mutate, pending: sending || refreshing, result }
}

function CheckoutFeedback({ pending, result }: { pending: boolean; result: MutationResult | null }) {
  return <div className="cart-feedback" aria-live="polite" aria-atomic="true">
    {pending ? <p role="status">Updating checkout…</p> : result && <p role={result.ok ? "status" : "alert"}>{result.message}</p>}
    {!pending && result?.uncertain && <p><Link href="/checkout">Refresh checkout before making another change</Link></p>}
  </div>
}

function AddressField({ label, name, value, onChange, required = false, maxLength, autoComplete }: {
  label: string; name: keyof AddressForm; value: string; onChange: (value: string) => void; required?: boolean; maxLength: number; autoComplete: string
}) {
  return <label className="checkout-field">
    <span>{label}{required ? " *" : ""}</span>
    <input name={name} value={value} onChange={(event) => onChange(event.currentTarget.value)} required={required} maxLength={maxLength} autoComplete={autoComplete} />
  </label>
}

function AddressSection({ address, setAddress, sameBilling, setSameBilling, disabled, onSubmit }: {
  address: AddressForm; setAddress: (update: (current: AddressForm) => AddressForm) => void; sameBilling: boolean; setSameBilling: (value: boolean) => void
  disabled: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const update = (name: keyof AddressForm) => (value: string) => setAddress((current) => ({ ...current, [name]: value }))
  return <section className="checkout-section" aria-labelledby="shipping-address-heading">
    <h2 id="shipping-address-heading">Shipping address</h2>
    <p className="muted small">Use the country code for the configured shopping region. Required fields are marked with an asterisk.</p>
    <form onSubmit={onSubmit} className="checkout-form">
      <fieldset className="checkout-fields" disabled={disabled}>
        <legend className="sr-only">Shipping address fields</legend>
        <div className="checkout-field-grid">
          <AddressField label="First name" name="firstName" value={address.firstName} onChange={update("firstName")} required maxLength={100} autoComplete="shipping given-name" />
          <AddressField label="Last name" name="lastName" value={address.lastName} onChange={update("lastName")} required maxLength={100} autoComplete="shipping family-name" />
          <AddressField label="Address line 1" name="address1" value={address.address1} onChange={update("address1")} required maxLength={200} autoComplete="shipping address-line1" />
          <AddressField label="Address line 2" name="address2" value={address.address2} onChange={update("address2")} maxLength={200} autoComplete="shipping address-line2" />
          <AddressField label="City" name="city" value={address.city} onChange={update("city")} required maxLength={100} autoComplete="shipping address-level2" />
          <AddressField label="Province / state" name="province" value={address.province} onChange={update("province")} maxLength={100} autoComplete="shipping address-level1" />
          <AddressField label="Postal code" name="postalCode" value={address.postalCode} onChange={update("postalCode")} required maxLength={32} autoComplete="shipping postal-code" />
          <AddressField label="Country code" name="countryCode" value={address.countryCode} onChange={update("countryCode")} required maxLength={2} autoComplete="shipping country" />
          <AddressField label="Phone" name="phone" value={address.phone} onChange={update("phone")} maxLength={40} autoComplete="shipping tel" />
          <AddressField label="Company" name="company" value={address.company} onChange={update("company")} maxLength={100} autoComplete="shipping organization" />
        </div>
        <label className="checkbox-field"><input type="checkbox" checked={sameBilling} onChange={(event) => setSameBilling(event.currentTarget.checked)} /> <span>Use this address for billing</span></label>
        <button className="button" type="submit">Save address and load shipping</button>
      </fieldset>
    </form>
  </section>
}

function ShippingSection({ state, selectedOptionId, setSelectedOptionId, disabled, onSelect }: {
  state: CheckoutState & { cart: CheckoutCart }; selectedOptionId: string; setSelectedOptionId: (id: string) => void; disabled: boolean; onSelect: (id: string) => void
}) {
  return <section className="checkout-section" aria-labelledby="shipping-method-heading" aria-busy={disabled}>
    <h2 id="shipping-method-heading">Shipping method</h2>
    {state.shippingState === "address-required" && <p className="notice compact">Save a complete shipping address to load real shipping options.</p>}
    {state.shippingState === "configuration" && <p className="notice compact" role="alert">Shipping is not configured for this region. No free shipping or fallback option has been assumed.</p>}
    {state.shippingState === "backend" && <p className="notice compact" role="alert">Shipping options could not be loaded from the store. Please refresh checkout and try again.</p>}
    {state.shippingState === "none" && <p className="notice compact">No shipping options are currently available for this address. The store must configure a real option before checkout can proceed; no free shipping is being promised.</p>}
    {state.shippingState === "available" && <fieldset className="shipping-options" disabled={disabled}>
      <legend className="sr-only">Available shipping methods</legend>
      {state.shippingOptions.map((option) => <label className={`shipping-option${option.insufficientInventory ? " unavailable" : ""}`} key={option.id}>
        <input type="radio" name="shipping-option" value={option.id} checked={selectedOptionId === option.id} disabled={disabled || option.insufficientInventory} onChange={() => {
          setSelectedOptionId(option.id)
          onSelect(option.id)
        }} />
        <span><strong>{option.name}</strong>{option.insufficientInventory ? <span className="muted"> (not available for current inventory)</span> : null}<br />
          <span>{formatPrice(option.amount)}{option.isTaxInclusive ? " (tax inclusive)" : " (before tax)"}</span>
        </span>
      </label>)}
    </fieldset>}
    {state.cart.shippingMethods.map((method) => <p className="muted small" key={method.optionId}>Current cart method{method.name ? `: ${method.name}` : ""} · {formatPrice(method.amount)}{method.isTaxInclusive ? " (tax inclusive)" : " (before tax)"}</p>)}
    {state.cart.shippingMethods.length > 0 && <p className="muted small">Selected method is reconciled from the current cart after each change.</p>}
  </section>
}

function PaymentSection() {
  return <section className="checkout-section" aria-labelledby="payment-heading">
    <h2 id="payment-heading">Payment</h2>
    <p>Payment is not configured for this store yet. Stripe is not connected, so no payment collection, payment session, or order will be created.</p>
    <button type="button" disabled aria-disabled="true">Payment unavailable</button>
  </section>
}

function CartSummary({ cart }: { cart: CheckoutCart }) {
  return <section className="checkout-section checkout-summary" aria-labelledby="checkout-totals-heading">
    <h2 id="checkout-totals-heading">Current cart and estimated totals ({cart.currencyCode.toUpperCase()})</h2>
    <ul className="checkout-lines" aria-label="Current cart lines">
      {cart.lines.map((line) => <li key={line.id}>
        <div className="checkout-line-image"><ProductImage src={line.thumbnail ?? undefined} alt={line.title} /></div>
        <div><strong>{line.title}</strong>{line.variantTitle && <span className="muted"> · {line.variantTitle}</span>}<br /><span>Quantity: {line.quantity}</span></div>
        <strong>{formatPrice(line.total)}</strong>
      </li>)}
    </ul>
    <dl className="checkout-totals">
      <dt>Items subtotal (before tax)</dt><dd>{formatPrice(cart.itemSubtotal)}</dd>
      {cart.discountTotal && <><dt>Discounts reported by store</dt><dd>{formatPrice(cart.discountTotal)}</dd></>}
      {cart.taxTotal && <><dt>Estimated tax</dt><dd>{formatPrice(cart.taxTotal)}</dd></>}
      {cart.shippingMethods.length === 0
        ? <><dt>Shipping</dt><dd>Not selected</dd></>
        : cart.shippingTotal
          ? <><dt>Shipping reported by store</dt><dd>{formatPrice(cart.shippingTotal)}</dd></>
          : <><dt>Shipping</dt><dd>Not reported by store</dd></>}
      <dt>Estimated total reported by store</dt><dd className="price">{formatPrice(cart.total)}</dd>
    </dl>
    <p className="muted small">Amounts are Medusa’s current major-unit estimates. They are not a final purchase quote until shipping, tax, and payment are configured and finalized.{cart.shippingMethods.length === 0 ? " No shipping method is selected; no free shipping is promised." : ""}</p>
  </section>
}

export default function CheckoutForm({ state }: { state: CheckoutState & { cart: CheckoutCart } }) {
  const [address, setAddress] = useState<AddressForm>(() => emptyAddress(state.cart.shippingAddress))
  const [sameBilling, setSameBilling] = useState(true)
  const [selectedOptionId, setSelectedOptionId] = useState(state.cart.shippingMethods[0]?.optionId ?? "")
  const { mutate, pending, result } = useCheckoutMutation()
  const disabled = pending || result?.uncertain === true

  async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await mutate({ action: "update-address", address: address as AddressInput, useSameBilling: sameBilling })
    if (response.ok) setSelectedOptionId("")
  }
  async function selectShipping(optionId: string) {
    const response = await mutate({ action: "select-shipping", optionId })
    if (!response.ok) setSelectedOptionId(state.cart.shippingMethods[0]?.optionId ?? "")
  }

  return <div className="checkout-layout">
    <div>
      <p className="breadcrumb"><Link href="/cart">Back to cart</Link></p>
      <CheckoutFeedback pending={pending} result={result} />
      <AddressSection address={address} setAddress={setAddress} sameBilling={sameBilling} setSameBilling={setSameBilling} disabled={disabled} onSubmit={saveAddress} />
      <ShippingSection state={state} selectedOptionId={selectedOptionId} setSelectedOptionId={setSelectedOptionId} disabled={disabled} onSelect={(id) => void selectShipping(id)} />
      <PaymentSection />
    </div>
    <CartSummary cart={state.cart} />
  </div>
}
