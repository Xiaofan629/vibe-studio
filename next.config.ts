import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

// Check if we're in Tauri build mode
const isTauriBuild = process.env.TAURI_ENV === "production" || process.env.NODE_ENV === "production"
const internalHost = process.env.TAURI_DEV_HOST || "localhost"
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
})

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Only set assetPrefix for Tauri dev mode, not for production build
  assetPrefix: isTauriBuild ? undefined : `http://${internalHost}:3000`,
}

export default withNextIntl(nextConfig)
