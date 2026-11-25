import type { Metadata } from "next"
import Link from "next/link"
import CatalogNotice from "@/components/catalog-notice"
import ProductImage from "@/components/product-image"
import { MAX_PAGE, PAGE_SIZE, parsePage, productHref, productPrice } from "@/lib/catalog"
import { getStore } from "@/lib/store"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "All products | B2C Store", description: "Browse our product catalog." }

type Props = { searchParams: Promise<{ page?: string | string[] }> }

export default async function StorePage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page)
  let result
  try {
    const { api, region } = await getStore()
    result = { ...await api.listProducts(region, page), region }
  } catch (error) {
    return <CatalogNotice error={error} retryHref={`/store?page=${page}`} />
  }
  const { products, count, region } = result
  const pages = Math.min(MAX_PAGE, Math.ceil(count / PAGE_SIZE))
  return (
    <>
      <div className="catalog-heading">
        <p className="eyebrow">Product catalog</p>
        <h1>All products</h1>
        <p className="muted">{region.name} · {region.countryCode.toUpperCase()} · {region.currencyCode.toUpperCase()}</p>
        <p className="muted">{count} {count === 1 ? "product" : "products"}</p>
      </div>
      {!products.length ? (
        <section className="notice">
          <h2>{count === 0 ? "No products yet" : "No products on this page"}</h2>
          <p>{count === 0 ? "There are no published products available in this store yet. Please check back later." : "This page is outside the current catalog."}</p>
          {page > 1 && <Link href="/store">Back to first page</Link>}
        </section>
      ) : (
        <ul className="product-grid" aria-label="Products">
          {products.map((product) => (
            <li key={product.id} className="product-card">
              <Link href={productHref(product.handle)} prefetch={false}>
                <ProductImage src={product.images[0]} alt={product.title} />
                <div className="product-card-body">
                  <h2>{product.title}</h2>
                  <p className="price">{productPrice(product)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {count > 0 && (
        <nav className="pagination" aria-label="Product pages">
          {page > 1 && <Link className="page-link" href={`/store?page=${page - 1}`} prefetch={false}>Previous</Link>}
          <span aria-current="page">Page {page}{page <= pages ? ` of ${pages}` : ""}</span>
          {page < pages && <Link className="page-link" href={`/store?page=${page + 1}`} prefetch={false}>Next</Link>}
        </nav>
      )}
    </>
  )
}
