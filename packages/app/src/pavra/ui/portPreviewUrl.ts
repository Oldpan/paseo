// Migrated from Bigbang apps/app/src/portPreviewUrl.ts. Keep presentation changes reviewable against that source.

export interface ParsedPreviewablePortUrl {
  url: string;
  protocol: "http:";
  hostname: string;
  port: number;
  pathAndQuery: string;
}

export interface ResolvePortPreviewTargetInput {
  rawUrl?: string;
  port?: number;
  path?: string;
  hostEndpoint?: string | null;
}

export interface HostEndpointSource {
  activeConnection?: { type: string; endpoint: string } | null;
  connections?: ReadonlyArray<{
    type: string;
    endpoint?: string;
    host?: string;
  }>;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();
}

function formatUrlHost(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/u.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);
  return octets !== null && octets[0] === 127;
}

export function isLoopbackOrUnspecifiedHost(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname);
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    isLoopbackIpv4(normalized)
  );
}

export function isServiceProxyLocalhost(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname);
  return normalized.length > ".localhost".length && normalized.endsWith(".localhost");
}

export function isPrivateLanIpv4(hostname: string): boolean {
  const octets = parseIpv4Octets(stripIpv6Brackets(hostname));
  if (!octets) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function isValidPreviewPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isPreviewableAgentPortUrl(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.username || url.password) return false;
  if (url.port !== "") {
    const portNum = Number(url.port);
    if (!isValidPreviewPort(portNum)) return false;
  }
  const hostname = stripIpv6Brackets(url.hostname);
  if (isLoopbackOrUnspecifiedHost(hostname) || isServiceProxyLocalhost(hostname)) {
    return true;
  }
  return isPrivateLanIpv4(hostname);
}

function stripControlChars(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) {
      out += input[i];
    }
  }
  return out;
}

/**
 * Ensures a preview path starts with a single `/` and strips control characters
 * and unsafe URI schemes (`javascript:`, `data:`, `vbscript:`, `file:`, etc.)
 * as well as protocol-relative prefixes (`//evil.com`).
 */
export function normalizePreviewPath(path: string): string {
  if (typeof path !== "string") return "/";
  const cleaned = stripControlChars(path).trim();
  if (!cleaned) return "/";

  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(cleaned) ||
    /^[/\\]+(?:javascript|data|vbscript|file|blob|about|http|https|ws|wss):/iu.test(cleaned)
  ) {
    return "/";
  }

  const strippedLeading = cleaned.replace(/^[/\\]+/u, "");
  return `/${strippedLeading}`;
}

/**
 * Parses a previewable local/LAN agent port URL into its normalized components.
 */
export function parsePreviewablePortUrl(raw: string): ParsedPreviewablePortUrl | null {
  if (!isPreviewableAgentPortUrl(raw)) return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const port = parsed.port !== "" ? Number(parsed.port) : 80;
  if (!isValidPreviewPort(port)) return null;

  const hostname = stripIpv6Brackets(parsed.hostname);
  const rawPathAndQuery = `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
  const pathAndQuery = normalizePreviewPath(rawPathAndQuery);
  const url = `http://${formatUrlHost(hostname)}:${port}${pathAndQuery}`;

  return {
    url,
    protocol: "http:",
    hostname,
    port,
    pathAndQuery,
  };
}

/**
 * Extracts a reachable LAN or local hostname from a Paseo host endpoint string
 * (e.g. `"http://192.168.0.149:6778"`, `"192.168.0.149:6778"`, `"http://127.0.0.1:6778"`).
 * Returns `null` for non-TCP or public relay endpoints.
 */
export function extractHostEndpointHostname(hostEndpoint?: string | null): string | null {
  if (typeof hostEndpoint !== "string") return null;
  const trimmed = hostEndpoint.trim();
  if (
    !trimmed ||
    trimmed === "socket" ||
    trimmed === "pipe" ||
    trimmed === "relay" ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith("via ")
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(trimmed)
      ? new URL(trimmed)
      : new URL(`http://${trimmed}`);
  } catch {
    return null;
  }

  const hostname = stripIpv6Brackets(parsed.hostname);
  if (!hostname) return null;

  if (hostname === "0.0.0.0") {
    return "localhost";
  }

  if (
    isLoopbackOrUnspecifiedHost(hostname) ||
    isServiceProxyLocalhost(hostname) ||
    isPrivateLanIpv4(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".lan")
  ) {
    return hostname;
  }

  return null;
}

/**
 * Picks the best reachable LAN/local endpoint from a Paseo `HostProfile` / `HostRuntimeSnapshot`.
 */
export function pickHostReachableEndpoint(source?: HostEndpointSource | null): string | null {
  if (!source) return null;
  const active = source.activeConnection;
  if (
    active &&
    (active.type === "directTcp" || active.type === "remoteSsh") &&
    extractHostEndpointHostname(active.endpoint)
  ) {
    return active.endpoint;
  }

  if (source.connections) {
    for (const conn of source.connections) {
      if (
        conn.type === "directTcp" &&
        conn.endpoint &&
        extractHostEndpointHostname(conn.endpoint)
      ) {
        return conn.endpoint;
      }
      if (conn.type === "remoteSsh" && conn.host && extractHostEndpointHostname(conn.host)) {
        return conn.host;
      }
    }
  }

  return null;
}

/**
 * Resolves the final HTTP URL to load in `PortPreviewModal`.
 *
 * - If `rawUrl` is a loopback/unspecified URL (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`)
 *   and `hostEndpoint` has a reachable LAN/local hostname (e.g. `192.168.0.149`),
 *   rewrites the hostname to that machine's hostname while preserving port and path.
 * - If `rawUrl` already has an explicit LAN IP (`192.168.x.x` / `10.x.x.x` / `172.16-31.x.x`),
 *   preserves that explicit LAN IP.
 * - If `rawUrl` is omitted and `port` is provided, constructs the preview URL from
 *   `hostEndpoint` (or `"localhost"` fallback), `port`, and normalized `path`.
 */
export function resolvePortPreviewTargetUrl(input: ResolvePortPreviewTargetInput): string | null {
  const endpointHost = extractHostEndpointHostname(input.hostEndpoint);

  if (input.rawUrl !== undefined && input.rawUrl.trim() !== "") {
    const parsed = parsePreviewablePortUrl(input.rawUrl);
    if (!parsed) return null;

    const port = input.port ?? parsed.port;
    if (!isValidPreviewPort(port)) return null;

    const pathAndQuery =
      input.path !== undefined ? normalizePreviewPath(input.path) : parsed.pathAndQuery;

    let targetHostname = parsed.hostname;
    if (isLoopbackOrUnspecifiedHost(parsed.hostname)) {
      if (endpointHost) {
        targetHostname = endpointHost;
      } else if (parsed.hostname === "0.0.0.0") {
        targetHostname = "localhost";
      }
    }

    return `http://${formatUrlHost(targetHostname)}:${port}${pathAndQuery}`;
  }

  if (!isValidPreviewPort(input.port)) {
    return null;
  }

  const targetHostname = endpointHost ?? "localhost";
  const pathAndQuery = normalizePreviewPath(input.path ?? "/");
  return `http://${formatUrlHost(targetHostname)}:${input.port}${pathAndQuery}`;
}
