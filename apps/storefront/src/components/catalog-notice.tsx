import { catalogErrorMessage } from "@/lib/store-api"

export default function CatalogNotice({ error, retryHref }: { error: unknown; retryHref: string }) {
  const { title, message } = catalogErrorMessage(error)
  return (
    <section className="notice" role="status" aria-labelledby="notice-title">
      <h1 id="notice-title">{title}</h1>
      <p>{message}</p>
      {/* A full request retries even when the current route is in the client router cache. */}
      <a className="button" href={retryHref}>Try again</a>
    </section>
  )
}
