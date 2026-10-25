import { Buffer } from "buffer";

// Expo DOM imperative calls serialize JSON. Encode bytes explicitly so UTF-8 sequences split
// between PTY frames survive the native/WebView hop without decoding and re-encoding text.
export function encodeTerminalBytes(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

export type EncodedTerminalFile =
  | { streamKey: string; error: string }
  | { streamKey: string; file: { fileName: string; mimeType: string; base64: string } | null };
export function decodeTerminalBytes(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64"));
}
