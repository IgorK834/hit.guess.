/** @type {import('next').NextConfig} */
function addApiOriginPattern(remotePatterns) {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return;
  try {
    const u = new URL(raw);
    const pattern = {
      protocol: u.protocol.replace(":", ""),
      hostname: u.hostname,
      // Covers both `/api/v1/cover/image` proxy and any other remote image URLs.
      pathname: "/**",
    };
    if (u.port) pattern.port = u.port;
    remotePatterns.push(pattern);
  } catch {
    // If env is malformed, just skip adding the API origin.
  }
}

const remotePatterns = [
  // TIDAL image CDNs (direct cover URLs if ever returned by the API).
  { protocol: "https", hostname: "resources.tidal.com", pathname: "/**" },
  { protocol: "https", hostname: "images.tidal.com", pathname: "/**" },
];

// Dev-local API (common in local development).
remotePatterns.push({ protocol: "http", hostname: "localhost", port: "8000", pathname: "/**" });

// If cover proxy URLs are absolute, allow the configured API origin too.
addApiOriginPattern(remotePatterns);

const nextConfig = {
  // App Router: Server Components default to SSR/streaming; static routes are prerendered (SSG).
  reactStrictMode: true,
  images: {
    remotePatterns,
  },
  // Use `output: "standalone"` only when you build a Docker image and copy `.next/static`
  // per Next docs — it is easy to misconfigure locally and get 404s on `/_next/*` assets.
};

export default nextConfig;
