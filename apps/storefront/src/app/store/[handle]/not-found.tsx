import Link from "next/link"

export default function ProductNotFound() {
  return (
    <section className="notice">
      <h1>Product not found</h1>
      <p>This product does not exist or is no longer available in this store.</p>
      <Link className="button" href="/store">Browse products</Link>
    </section>
  )
}
