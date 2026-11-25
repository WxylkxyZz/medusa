const fs = require("node:fs")
const path = require("node:path")

const backendRoot = path.resolve(__dirname, "..")
const publicPath = path.join(backendRoot, "public")
const builtPublicPath = path.join(backendRoot, ".medusa", "server", "public")

if (!fs.existsSync(path.join(builtPublicPath, "admin", "index.html"))) {
  throw new Error(
    `Medusa admin build not found at ${path.join(builtPublicPath, "admin")}`
  )
}

fs.rmSync(publicPath, { recursive: true, force: true })
fs.symlinkSync(path.relative(path.dirname(publicPath), builtPublicPath), publicPath, "dir")
