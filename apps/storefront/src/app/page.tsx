import Link from "next/link"

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Medusa storefront</p>
        <h1 id="page-title">Product browsing</h1>
        <p className="lede">
          Browse products, compare available options, and view regional prices.
          Save available options in your guest cart. Checkout and payment are not available yet.
        </p>
        <Link className="button" href="/store">
          Browse products
        </Link>
        <p><Link href="/cart">View cart</Link></p>
      </section>
    </main>
  )
}
