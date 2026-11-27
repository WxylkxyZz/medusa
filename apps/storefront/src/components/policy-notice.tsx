import Link from "next/link"

export function NotPublished({ policy }: { policy: string }) {
  return (
    <section className="notice" role="status">
      <h2>{policy} policy not published</h2>
      <p>No {policy.toLowerCase()} policy has been published for this store yet. Please contact the store operator before ordering.</p>
    </section>
  )
}

export function PolicyShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="policy-page">
      <p className="eyebrow">Store policy</p>
      <h1>{title}</h1>
      {children}
      <p><Link href="/store">Back to products</Link></p>
    </section>
  )
}
