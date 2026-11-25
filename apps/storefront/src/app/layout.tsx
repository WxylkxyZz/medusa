import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "B2C Store",
  description: "B2C storefront powered by Medusa",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
