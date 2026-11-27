import Link from "next/link"

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <Link className="site-name" href="/">B2C Store</Link>
        <nav aria-label="Main navigation"><Link href="/store">All products</Link><Link href="/shipping">Shipping</Link><Link href="/returns">Returns</Link><Link href="/cart">Cart</Link></nav>
      </header>
      <main id="main-content" className="store-shell">{children}</main>
      <footer className="site-footer">Product catalog and guest cart · Checkout address and shipping foundation · Payment not configured</footer>
    </>
  )
}
