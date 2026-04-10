/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router: Server Components default to SSR/streaming; static routes are prerendered (SSG).
  reactStrictMode: true,
  // Smaller Node images when we add Docker for the frontend.
  output: "standalone",
};

export default nextConfig;
