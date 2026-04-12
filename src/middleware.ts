import { NextResponse, type NextRequest } from "next/server";

/**
 * Security middleware: blocks requests to API routes that don't originate
 * from localhost. Prevents CSRF attacks from malicious websites.
 */
export function middleware(request: NextRequest) {
  // Only protect API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check Origin/Referer for all requests (GET included) to prevent
  // cross-origin reads of sensitive session/token data
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    const originUrl = safeParseUrl(origin);
    if (!originUrl || !isLocalhost(originUrl.hostname)) {
      return NextResponse.json(
        { error: "Forbidden: non-local origin" },
        { status: 403 }
      );
    }
  }

  if (!origin && referer) {
    const refererUrl = safeParseUrl(referer);
    if (!refererUrl || !isLocalhost(refererUrl.hostname)) {
      return NextResponse.json(
        { error: "Forbidden: non-local referer" },
        { status: 403 }
      );
    }
  }

  // For state-changing methods, require Origin or Referer
  if (request.method !== "GET" && !origin && !referer) {
    return NextResponse.json(
      { error: "Forbidden: missing origin" },
      { status: 403 }
    );
  }

  // Verify the request is coming to a local address
  const host = request.headers.get("host");
  if (host) {
    const hostname = host.split(":")[0];
    if (!isLocalhost(hostname)) {
      return NextResponse.json(
        { error: "Forbidden: non-local host" },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const config = {
  matcher: "/api/:path*",
};
