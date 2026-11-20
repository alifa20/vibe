// Saving results. Every blob URL is revoked once its download has started.

export interface DownloadEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  click(href: string, fileName: string): void;
  /** Runs after the click has been handled; revoking in the same tick can cancel the download in some browsers. */
  defer(fn: () => void): void;
}

export const browserDownloadEnv = (): DownloadEnv => ({
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  click(href, fileName) {
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.rel = "noopener";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
  },
  defer: (fn) => setTimeout(fn, 1000),
});

export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string, env: DownloadEnv = browserDownloadEnv()): void {
  const url = env.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  env.click(url, fileName);
  env.defer(() => env.revokeObjectURL(url));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const mimeFor = (name: string): string =>
  name.endsWith(".pdf") ? "application/pdf"
  : name.endsWith(".zip") ? "application/zip"
  : name.endsWith(".png") ? "image/png"
  : name.endsWith(".jpg") ? "image/jpeg"
  : "application/octet-stream";
