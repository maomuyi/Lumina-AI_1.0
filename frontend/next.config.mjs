import { dirname } from "node:path"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendOrigin = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:3001"

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/downloads/:path*",
        destination: `${backendOrigin}/downloads/:path*`,
      },
    ]
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
}

export default nextConfig
