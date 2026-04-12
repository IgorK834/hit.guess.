/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router: Server Components default to SSR/streaming; static routes are prerendered (SSG).
  reactStrictMode: true,
  // Use `output: "standalone"` only when you build a Docker image and copy `.next/static`
  // per Next docs — it is easy to misconfigure locally and get 404s on `/_next/*` assets.
};

export default nextConfig;
