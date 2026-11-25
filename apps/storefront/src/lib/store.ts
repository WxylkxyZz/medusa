import "server-only"
import { cache } from "react"
import { createStoreApi } from "./store-api"

// Next also replaces aliased env.NEXT_PUBLIC_* property reads after compilation.
// Reflect.get avoids both that pass and direct process.env constant substitution.
const readEnv = (name: string): string | undefined => Reflect.get(process.env, name)

export const readStoreEnvironment = () => ({
  MEDUSA_BACKEND_URL_INTERNAL: readEnv("MEDUSA_BACKEND_URL_INTERNAL"),
  MEDUSA_SALES_CHANNEL_ID: readEnv("MEDUSA_SALES_CHANNEL_ID"),
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: readEnv("NEXT_PUBLIC_MEDUSA_BACKEND_URL"),
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: readEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"),
  NEXT_PUBLIC_DEFAULT_REGION: readEnv("NEXT_PUBLIC_DEFAULT_REGION"),
})

// Only this server-only boundary reads environment values. API core is injectable for offline tests.
export const getStore = cache(async () => {
  const api = createStoreApi(readStoreEnvironment())
  const region = await api.resolveRegion()
  return { api, region }
})

export const getProduct = cache(async (handle: string) => {
  const { api, region } = await getStore()
  return { product: await api.getProduct(region, handle), region }
})
