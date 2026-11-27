import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import CatalogNotice from "@/components/catalog-notice"
import ProductImage from "@/components/product-image"
import VariantPicker from "@/components/variant-picker"
import { productHref, productPrice } from "@/lib/catalog"
import { getProduct } from "@/lib/store"
import { siteOrigin } from "@/lib/site"
import { productPageMetadata, productStructuredData, toJsonLd } from "@/lib/product-metadata"

export const dynamic = "force-dynamic"
type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { product, region } = await getProduct((await params).handle)
    return productPageMetadata(product, region, siteOrigin()) as Metadata
  } catch {
    // The page renders a safe, actionable failure message.
  }
  return { title: "Product | B2C Store", robots: { index: false, follow: false } }
}

export default async function ProductPage({ params }: Props) {
  const { handle } = await params
  let result
  try {
    result = await getProduct(handle)
  } catch (error) {
    return <CatalogNotice error={error} retryHref={productHref(handle)} />
  }
  const { product, region } = result
  // Only a successful Store API response with no matching published product is a 404.
  if (!product) notFound()
  const origin = siteOrigin()
  const url = origin ? `${origin}${productHref(product.handle)}` : productHref(product.handle)
  // Open Graph product tags render through generateMetadata ("other"); inline og:* here is dropped.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLd(productStructuredData(product, region, url)) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/store">All products</Link><span aria-hidden="true"> / </span><span aria-current="page">{product.title}</span></nav>
      <article className="product-detail">
        <section className="product-gallery" aria-label="Product images">
          {product.images.length ? product.images.map((image, index) => <ProductImage key={image} src={image} alt={`${product.title} — image ${index + 1}`} priority={index === 0} />) : <ProductImage alt={product.title} />}
        </section>
        <div className="product-information">
          {product.collection && <p className="eyebrow">{product.collection}</p>}
          <h1>{product.title}</h1>
          {product.subtitle && <p className="lede">{product.subtitle}</p>}
          <p className="price product-summary-price">{productPrice(product)}</p>
          <p className="muted small">Prices in {region.currencyCode.toUpperCase()} for {region.countryCode.toUpperCase()}. Final taxes and shipping are not quoted here.</p>
          <VariantPicker key={product.id} handle={product.handle} options={product.options} variants={product.variants} />
          <section className="description" aria-labelledby="description-heading"><h2 id="description-heading">Description</h2><p>{product.description || "No description available."}</p></section>
          {product.material && <dl><dt>Material</dt><dd>{product.material}</dd></dl>}
        </div>
      </article>
    </>
  )
}
