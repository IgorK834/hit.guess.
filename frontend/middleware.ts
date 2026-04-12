import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * In development, stop the browser from caching HTML. Otherwise after `next dev`
 * restarts or `.next` rebuilds, a normal refresh can keep an old document that still
 * points at previous `/_next/static/...` hashes → 404 on CSS/JS and a “broken” page.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
