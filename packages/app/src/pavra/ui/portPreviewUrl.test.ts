import { describe, expect, it } from "vitest";
import {
  extractHostEndpointHostname,
  isPreviewableAgentPortUrl,
  normalizePreviewPath,
  parsePreviewablePortUrl,
  pickHostReachableEndpoint,
  resolvePortPreviewTargetUrl,
} from "./portPreviewUrl";

describe("isPreviewableAgentPortUrl", () => {
  it("accepts loopback, 0.0.0.0, IPv6 loopback, and Service Proxy *.localhost URLs", () => {
    expect(isPreviewableAgentPortUrl("http://localhost:3000")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://localhost:5173/dashboard?tab=1")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://127.0.0.1:8080/api/health")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://127.0.1.1:4000")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://0.0.0.0:8000")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://[::1]:3000/test")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://dev--miniweb.localhost:6767/")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://web--feature-auth--app.localhost/login")).toBe(true);
  });

  it("accepts RFC1918 private LAN IPv4 URLs", () => {
    expect(isPreviewableAgentPortUrl("http://192.168.0.149:3000/foo")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://10.0.0.42:8080")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://172.16.0.1:5173")).toBe(true);
    expect(isPreviewableAgentPortUrl("http://172.31.255.254:9000")).toBe(true);
  });

  it("rejects non-http protocols, credentials, and public/external hosts", () => {
    expect(isPreviewableAgentPortUrl("https://localhost:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("ws://localhost:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("javascript:alert(1)")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://user:pass@localhost:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://example.com:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://8.8.8.8:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://172.15.0.1:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://172.32.0.1:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("http://192.169.1.1:3000")).toBe(false);
    expect(isPreviewableAgentPortUrl("")).toBe(false);
  });
});

describe("normalizePreviewPath", () => {
  it("ensures a single leading slash and preserves query strings and hashes", () => {
    expect(normalizePreviewPath("")).toBe("/");
    expect(normalizePreviewPath("   ")).toBe("/");
    expect(normalizePreviewPath("/")).toBe("/");
    expect(normalizePreviewPath("foo/bar")).toBe("/foo/bar");
    expect(normalizePreviewPath("/foo/bar?x=1#section")).toBe("/foo/bar?x=1#section");
    expect(normalizePreviewPath("api/v1/items:batchGet?limit=10")).toBe(
      "/api/v1/items:batchGet?limit=10",
    );
  });

  it("collapses multiple leading slashes and blocks protocol-relative or unsafe schemes", () => {
    expect(normalizePreviewPath("//evil.com/phish")).toBe("/evil.com/phish");
    expect(normalizePreviewPath("///nested/path")).toBe("/nested/path");
    expect(normalizePreviewPath("\\\\evil.com\\path")).toBe("/evil.com\\path");
    expect(normalizePreviewPath("javascript:alert(1)")).toBe("/");
    expect(normalizePreviewPath("JAVASCRIPT:alert(1)")).toBe("/");
    expect(normalizePreviewPath("java\nscript:alert(1)")).toBe("/");
    expect(normalizePreviewPath("/javascript:alert(1)")).toBe("/");
    expect(normalizePreviewPath("data:text/html,<script>alert(1)</script>")).toBe("/");
    expect(normalizePreviewPath("vbscript:msgbox(1)")).toBe("/");
    expect(normalizePreviewPath("file:///etc/passwd")).toBe("/");
    expect(normalizePreviewPath("http://evil.com/path")).toBe("/");
    expect(normalizePreviewPath("https://evil.com/path")).toBe("/");
  });
});

describe("parsePreviewablePortUrl", () => {
  it("parses valid previewable port URLs into structured fields", () => {
    expect(parsePreviewablePortUrl("http://localhost:3000/foo?bar=1#top")).toEqual({
      url: "http://localhost:3000/foo?bar=1#top",
      protocol: "http:",
      hostname: "localhost",
      port: 3000,
      pathAndQuery: "/foo?bar=1#top",
    });

    expect(parsePreviewablePortUrl("http://192.168.0.149:5173")).toEqual({
      url: "http://192.168.0.149:5173/",
      protocol: "http:",
      hostname: "192.168.0.149",
      port: 5173,
      pathAndQuery: "/",
    });

    expect(parsePreviewablePortUrl("http://[::1]:8080/health")).toEqual({
      url: "http://[::1]:8080/health",
      protocol: "http:",
      hostname: "::1",
      port: 8080,
      pathAndQuery: "/health",
    });
  });

  it("returns null for non-previewable URLs", () => {
    expect(parsePreviewablePortUrl("https://localhost:3000")).toBeNull();
    expect(parsePreviewablePortUrl("http://example.com:3000")).toBeNull();
    expect(parsePreviewablePortUrl("not-a-url")).toBeNull();
  });
});

describe("resolvePortPreviewTargetUrl", () => {
  it("rewrites loopback and 0.0.0.0 URLs to the connected machine's LAN/local hostname", () => {
    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://localhost:3000/foo?x=1",
        hostEndpoint: "http://192.168.0.149:6778",
      }),
    ).toBe("http://192.168.0.149:3000/foo?x=1");

    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://127.0.0.1:5173/app",
        hostEndpoint: "192.168.0.149:6778",
      }),
    ).toBe("http://192.168.0.149:5173/app");

    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://0.0.0.0:8000/docs",
        hostEndpoint: "http://127.0.0.1:6778",
      }),
    ).toBe("http://127.0.0.1:8000/docs");

    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://0.0.0.0:8000/docs",
        hostEndpoint: null,
      }),
    ).toBe("http://localhost:8000/docs");
  });

  it("keeps explicit LAN IPs in rawUrl even when hostEndpoint points to another host", () => {
    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://192.168.0.200:3000/custom",
        hostEndpoint: "http://192.168.0.149:6778",
      }),
    ).toBe("http://192.168.0.200:3000/custom");

    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://10.0.0.42:8080/metrics",
        hostEndpoint: "http://192.168.0.149:6778",
      }),
    ).toBe("http://10.0.0.42:8080/metrics");
  });

  it("supports overriding path or building from { port, path, hostEndpoint } for Studio", () => {
    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://localhost:3000/initial",
        path: "updated/route?debug=1",
        hostEndpoint: "http://192.168.0.149:6778",
      }),
    ).toBe("http://192.168.0.149:3000/updated/route?debug=1");

    expect(
      resolvePortPreviewTargetUrl({
        port: 5173,
        path: "/studio-preview",
        hostEndpoint: "http://192.168.0.149:6778",
      }),
    ).toBe("http://192.168.0.149:5173/studio-preview");

    expect(
      resolvePortPreviewTargetUrl({
        port: 8080,
        hostEndpoint: null,
      }),
    ).toBe("http://localhost:8080/");
  });

  it("ignores non-LAN relay endpoints and rejects invalid inputs", () => {
    expect(
      resolvePortPreviewTargetUrl({
        rawUrl: "http://localhost:3000/app",
        hostEndpoint: "https://relay.paseo.sh",
      }),
    ).toBe("http://localhost:3000/app");

    expect(extractHostEndpointHostname("socket")).toBeNull();
    expect(extractHostEndpointHostname("relay")).toBeNull();
    expect(resolvePortPreviewTargetUrl({ rawUrl: "https://google.com" })).toBeNull();
    expect(resolvePortPreviewTargetUrl({ port: 0 })).toBeNull();
    expect(resolvePortPreviewTargetUrl({ port: 70000 })).toBeNull();
  });

  it("picks reachable host endpoints from Paseo HostProfile / HostRuntimeSnapshot structures", () => {
    expect(
      pickHostReachableEndpoint({
        activeConnection: { type: "directTcp", endpoint: "192.168.0.149:6778" },
      }),
    ).toBe("192.168.0.149:6778");

    expect(
      pickHostReachableEndpoint({
        activeConnection: { type: "relay", endpoint: "https://relay.paseo.sh" },
        connections: [
          { type: "relay", endpoint: "https://relay.paseo.sh" },
          { type: "directTcp", endpoint: "192.168.0.149:6778" },
        ],
      }),
    ).toBe("192.168.0.149:6778");
  });
});
