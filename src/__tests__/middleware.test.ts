import { describe, it, expect } from "vitest";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

function makeRequest(
  path: string,
  opts: {
    method?: string;
    origin?: string;
    referer?: string;
    host?: string;
  } = {}
) {
  const { method = "GET", origin, referer, host = "localhost:3000" } = opts;
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  headers.set("host", host);

  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers,
  });
}

describe("proxy", () => {
  it("allows non-API routes without checks", () => {
    const res = proxy(makeRequest("/"));
    expect(res.status).toBe(200);
  });

  it("allows API requests from localhost origin", () => {
    const res = proxy(
      makeRequest("/api/overview", { origin: "http://localhost:3000" })
    );
    expect(res.status).toBe(200);
  });

  it("blocks API requests from foreign origin", () => {
    const res = proxy(
      makeRequest("/api/overview", { origin: "http://evil.com" })
    );
    expect(res.status).toBe(403);
  });

  it("blocks API requests from foreign referer", () => {
    const res = proxy(
      makeRequest("/api/overview", { referer: "http://evil.com/page" })
    );
    expect(res.status).toBe(403);
  });

  it("blocks POST without origin or referer", () => {
    const res = proxy(makeRequest("/api/sessions/kill", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("allows GET without origin or referer", () => {
    const res = proxy(makeRequest("/api/overview"));
    expect(res.status).toBe(200);
  });

  it("blocks API requests from non-local host", () => {
    const res = proxy(
      makeRequest("/api/overview", {
        origin: "http://localhost:3000",
        host: "remote-server.com:3000",
      })
    );
    expect(res.status).toBe(403);
  });

  it("allows requests from 127.0.0.1", () => {
    const res = proxy(
      makeRequest("/api/overview", {
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
      })
    );
    expect(res.status).toBe(200);
  });

  it("blocks invalid origin URLs", () => {
    const res = proxy(
      makeRequest("/api/overview", { origin: "not-a-url" })
    );
    expect(res.status).toBe(403);
  });
});
