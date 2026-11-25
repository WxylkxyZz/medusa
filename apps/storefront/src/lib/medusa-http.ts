import type { StoreEnvironment } from "./store-api.ts"

export class StoreRequestError extends Error {
  status: number
  type: string
  constructor(status: number, type = "") {
    super("Store request failed")
    this.status = status
    this.type = type
    this.name = "StoreRequestError"
  }
}

// Shared, injectable transport. No SDK retries: writes may have committed before a timeout.
export function createMedusaRequest(env: StoreEnvironment, fetcher: typeof fetch = fetch) {
  const key = env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY?.trim()
  const backend = env.MEDUSA_BACKEND_URL_INTERNAL?.trim() || env.NEXT_PUBLIC_MEDUSA_BACKEND_URL?.trim()
  let base: URL
  try {
    if (!key || !backend) throw new Error()
    base = new URL(backend)
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
    base.pathname = `${base.pathname.replace(/\/$/, "")}/`
  } catch { throw new StoreRequestError(401) }

  return async function request(path: string, params = new URLSearchParams(), method: "GET" | "POST" | "DELETE" = "GET", body?: object): Promise<Record<string, unknown>> {
    try {
      const url = new URL(path, base)
      url.search = params.toString()
      const response = await fetcher(url, {
        method, headers: { "x-publishable-api-key": key!, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) {
        // Only a small allowlisted error discriminator is retained, never messages/bodies.
        let type = ""
        if (response.status === 400 || response.status === 409 || response.status === 422) {
          try {
            const data: unknown = await response.json()
            if (data && typeof data === "object" && "code" in data && data.code === "insufficient_inventory") type = "insufficient_inventory"
          } catch { /* A malformed failure remains a failure. */ }
        }
        throw new StoreRequestError(response.status, type)
      }
      const data: unknown = await response.json()
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new StoreRequestError(0)
      return data as Record<string, unknown>
    } catch (error) {
      if (error instanceof StoreRequestError) throw error
      throw new StoreRequestError(0)
    }
  }
}
