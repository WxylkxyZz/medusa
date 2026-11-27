import type { Metadata } from "next"
import StoreLayout from "../store/layout"
import { NotPublished, PolicyShell } from "@/components/policy-notice"
import { getStore } from "@/lib/store"
import { formatDayRange, shippingPolicyState } from "@/lib/policies"
import { formatPrice } from "@/lib/catalog"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Shipping | B2C Store", description: "Published shipping price and transit time." }

export default async function ShippingPage() {
  let region
  try {
    region = (await getStore()).region
  } catch {
    return <StoreLayout><PolicyShell title="Shipping information"><NotPublished policy="Shipping" /></PolicyShell></StoreLayout>
  }
  const state = shippingPolicyState(region.metadata, region.currencyCode)
  return <StoreLayout><PolicyShell title="Shipping information">
    {state.status === "published" ? <>
      <p className="muted">{region.name} · {region.countryCode.toUpperCase()} · {region.currencyCode.toUpperCase()}</p>
      <dl className="policy-list">
        <dt>Service</dt><dd>{state.policy.service}</dd>
        <dt>Shipping price</dt><dd>{formatPrice(state.policy.rate)}</dd>
        <dt>Transit time</dt><dd>{formatDayRange(state.policy.transitDays)}</dd>
        <dt>Taxes</dt><dd>{state.policy.taxInclusive ? "Included in the displayed price" : "Not included in the displayed price"}</dd>
      </dl>
      <p>Available shipping methods and final totals are confirmed during checkout.</p>
    </> : <NotPublished policy="Shipping" />}
  </PolicyShell></StoreLayout>
}
