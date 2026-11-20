import { LOSSLESS_ARGS, type QpdfRunner } from "./ops/compress.ts";
import type { QpdfReply, QpdfRequest } from "./qpdf.worker.ts";

/** A QpdfRunner backed by a short-lived module worker and the self-hosted qpdf.wasm. */
export function createQpdfRunner(baseUrl: string): QpdfRunner {
  return (input) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./qpdf.worker.ts", import.meta.url), { type: "module" });
      const done = () => worker.terminate();
      worker.onmessage = (e: MessageEvent<QpdfReply>) => {
        done();
        if (e.data.ok) resolve(e.data.bytes);
        else reject(new Error(`Compression failed: ${e.data.error}`));
      };
      worker.onerror = (e) => {
        done();
        reject(new Error(`Compression failed: ${e.message || "the worker could not start"}`));
      };
      const request: QpdfRequest = { input, wasmUrl: new URL("qpdf/qpdf.wasm", baseUrl).href, args: [...LOSSLESS_ARGS] };
      worker.postMessage(request);
    });
}
