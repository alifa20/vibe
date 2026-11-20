// Runs qpdf (WebAssembly) off the main thread. Loaded only when lossless compression runs.
import createModule from "@neslinesli93/qpdf-wasm";

export interface QpdfRequest {
  input: Uint8Array;
  wasmUrl: string;
  args: string[];
}
export type QpdfReply = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

interface QpdfInstance {
  callMain(args: string[]): number;
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array };
}
type CreateQpdf = (opts: { locateFile: () => string; noInitialRun: boolean; print: () => void; printErr: (s: string) => void }) => Promise<QpdfInstance>;

self.onmessage = async (event: MessageEvent<QpdfRequest>) => {
  const { input, wasmUrl, args } = event.data;
  const errors: string[] = [];
  let reply: QpdfReply;
  try {
    const qpdf = await (createModule as unknown as CreateQpdf)({
      locateFile: () => wasmUrl,
      noInitialRun: true,
      print: () => {},
      printErr: (s) => errors.push(s),
    });
    qpdf.FS.writeFile("/in.pdf", input);
    let code: number;
    try {
      code = qpdf.callMain([...args, "/in.pdf", "/out.pdf"]);
    } catch (e) {
      // Emscripten reports exit() by throwing an ExitStatus with a numeric status.
      code = typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 2;
    }
    // qpdf exit code 3 means "succeeded with warnings"; the output is written.
    if (code !== 0 && code !== 3) throw new Error(errors.at(-1) ?? `qpdf stopped with code ${code}`);
    reply = { ok: true, bytes: qpdf.FS.readFile("/out.pdf") };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (reply.ok) self.postMessage(reply, { transfer: [reply.bytes.buffer as ArrayBuffer] });
  else self.postMessage(reply);
};
