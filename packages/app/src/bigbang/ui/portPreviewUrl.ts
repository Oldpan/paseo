// Migrated from Bigbang apps/app/src/portPreviewUrl.ts. Keep presentation changes reviewable against that source.
export function isPreviewableAgentPortUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.username || url.password) return false;
  const hostname = url.hostname.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.")
  )
    return true;
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
