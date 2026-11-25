import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { inlineStaticEnv } from "next/dist/lib/inline-static-env.js"

test("server environment survives Next's post-build public-variable substitution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storefront-env-"))
  const buildEnv = {
    NEXT_PUBLIC_MEDUSA_BACKEND_URL: "http://build.invalid:9000",
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_build_placeholder",
    NEXT_PUBLIC_DEFAULT_REGION: "us",
  }
  const previous = Object.fromEntries(Object.keys(buildEnv).map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, buildEnv)
    await mkdir(join(directory, "server"))
    await mkdir(join(directory, "static"))
    const source = await readFile(new URL("../src/lib/store.ts", import.meta.url), "utf8")
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const output = join(directory, "server", "store.js")
    await writeFile(output, compiled)
    // This Next.js pass rewrites even aliased env.NEXT_PUBLIC_* property access.
    await inlineStaticEnv({ distDir: directory, config: { env: {} } })
    const processed = await readFile(output, "utf8")
    assert.ok(!processed.includes(buildEnv.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY))

    const runtimeEnv = {
      MEDUSA_BACKEND_URL_INTERNAL: "http://runtime.internal:9000",
      MEDUSA_SALES_CHANNEL_ID: "sc_runtime",
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://runtime.example.com",
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_runtime",
      NEXT_PUBLIC_DEFAULT_REGION: "ca",
    }
    let received
    const exports = {}
    vm.runInNewContext(processed, {
      exports,
      process: { env: runtimeEnv },
      require(name) {
        if (name === "server-only") return {}
        if (name === "react") return { cache: (fn) => fn }
        if (name === "./store-api") return {
          createStoreApi(env) {
            received = env
            return { resolveRegion: async () => ({ id: "reg_runtime" }) }
          },
        }
        throw new Error(`Unexpected import: ${name}`)
      },
    })
    await exports.getStore()
    assert.equal(JSON.stringify(received), JSON.stringify(runtimeEnv))
    // With no internal override, the public fallback must also remain runtime-readable.
    delete runtimeEnv.MEDUSA_BACKEND_URL_INTERNAL
    await exports.getStore()
    assert.equal(received.MEDUSA_BACKEND_URL_INTERNAL, undefined)
    assert.equal(received.NEXT_PUBLIC_MEDUSA_BACKEND_URL, runtimeEnv.NEXT_PUBLIC_MEDUSA_BACKEND_URL)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
