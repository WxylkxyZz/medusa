"use client"

import { useState } from "react"
import { safeImageUrl } from "@/lib/catalog"

export default function ProductImage({ src, alt, priority = false }: { src?: string; alt: string; priority?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string>()
  const safeSrc = safeImageUrl(src)
  if (!safeSrc || failedSrc === safeSrc) return (
    <div className="image-placeholder" role="img" aria-label={`${alt} — image unavailable`}>
      <span>No image available</span>
    </div>
  )
  // Plain images intentionally avoid server-side image proxying and wildcard remote host permissions.
  // URLs are restricted to HTTP(S), loaded by the browser, and never receive API credentials.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="product-image" src={safeSrc} alt={alt} width={720} height={720}
      loading={priority ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer"
      onError={() => setFailedSrc(safeSrc)} />
  )
}
