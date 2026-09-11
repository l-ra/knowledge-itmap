import { CompressionStream, DecompressionStream } from "node:stream/web";

if (typeof globalThis.CompressionStream === "undefined") {
  Object.assign(globalThis, { CompressionStream, DecompressionStream });
}
