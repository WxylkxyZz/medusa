import type { Metadata } from "next"
import StoreLayout from "../store/layout"
import { NotPublished, PolicyShell } from "@/components/policy-notice"
import { getStore } from "@/lib/store"
import { returnsPolicyState } from "@/lib/policies"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Returns | B2C Store", description: "Published returns terms." }

export default async function ReturnsPage() {
  let region
  try {
    region = (await getStore()).region
  } catch {
    return <StoreLayout><PolicyShell title="Returns"><NotPublished policy="Returns" /></PolicyShell></StoreLayout>
  }
  const state = returnsPolicyState(region.metadata)
  return <StoreLayout><PolicyShell title="Returns">
    {state.status === "published" ? <>
      <p className="muted">{region.name} · {region.countryCode.toUpperCase()}</p>
      <dl className="policy-list">
        <dt>Return window</dt><dd>{state.policy.windowDays} {state.policy.windowDays === 1 ? "day" : "days"} after delivery</dd>
        {state.policy.method && <><dt>Return method</dt><dd>{state.policy.method === "mail" ? "By mail" : state.policy.method}</dd></>}
        {state.policy.freeReturns !== null && <><dt>Return shipping</dt><dd>{state.policy.freeReturns ? "Free" : "Paid by the customer"}</dd></>}
      </dl>
    </> : <NotPublished policy="Returns" />}
  </PolicyShell></StoreLayout>
}
