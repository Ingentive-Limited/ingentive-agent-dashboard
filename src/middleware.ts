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

  // Allow GET requests from any local origin (read-only)
  // Block non-GET (POST, PUT, DELETE) from non-local origins (state-changing)
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");

    // If Origin header is present, it must be localhost
    if (origin) {
      const originUrl = safeParseUrl(origin);
      if (!originUrl || !isLocalhost(originUrl.hostname)) {
        return NextResponse.json(
          { error: "Forbidden: non-local origin" },
          { status: 403 }
        );
      }
    }

    // If no Origin but Referer is present, check that too
    if (!origin && referer) {
      const refererUrl = safeParseUrl(referer);
      if (!refererUrl || !isLocalhost(refererUrl.hostname)) {
        return NextResponse.json(
          { error: "Forbidden: non-local referer" },
          { status: 403 }
        );
      }
    }

    // If neither Origin nor Referer, block the request (could be cross-site)
    if (!origin && !referer) {
      return NextResponse.json(
        { error: "Forbidden: missing origin" },
        { status: 403 }
      );
    }
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
    hostname === "::1" ||
    hostname === "0.0.0.0"
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
