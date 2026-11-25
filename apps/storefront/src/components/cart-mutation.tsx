"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CartError, cartErrorMessage } from "@/lib/cart"
import { sendCartMutation } from "@/lib/cart-client"
import type { CartMutation, MutationResult } from "@/lib/cart"

export function useCartMutation() {
  const router = useRouter()
  const locked = useRef(false)
  const [sending, setSending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [result, setResult] = useState<MutationResult | null>(null)
  async function mutate(input: CartMutation) {
    if (locked.current || refreshing || result?.uncertain) return
    locked.current = true
    setSending(true)
    setResult(null)
    try {
      // The shared browser lock also coordinates independent hooks and tabs.
      setResult(await sendCartMutation(input, navigator.locks))
      startTransition(() => { router.refresh() })
    } catch {
      setResult({ ok: false, message: cartErrorMessage(new CartError("uncertain")), uncertain: true })
      startTransition(() => { router.refresh() })
    } finally {
      locked.current = false
      setSending(false)
    }
  }
  return { mutate, pending: sending || refreshing, result }
}

export function CartFeedback({ pending, result }: { pending: boolean; result: MutationResult | null }) {
  return <div aria-live="polite" aria-atomic="true" className="cart-feedback">
    {pending ? <p role="status">Updating cart…</p> : result && <p role={result.ok ? "status" : "alert"}>{result.message}</p>}
    {!pending && result?.uncertain && <p><a href="/cart">Reload cart before making another change</a></p>}
  </div>
}
