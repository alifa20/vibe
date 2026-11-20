import { describe, expect, it } from "vitest";
import { downloadBytes, formatBytes } from "../src/ui/download.ts";
import { zipStore } from "../src/ui/zip.ts";

function fakeEnv() {
  const log: string[] = [];
  let n = 0;
  const deferred: (() => void)[] = [];
  const env = {
    createObjectURL: (b: Blob) => {
      log.push(`create:${b.type}:${b.size}`);
      return `blob:${++n}`;
    },
    revokeObjectURL: (u: string) => log.push(`revoke:${u}`),
    click: (href: string, name: string) => log.push(`click:${href}:${name}`),
    defer: (fn: () => void) => deferred.push(fn),
  };
  return { env, log, flush: () => deferred.splice(0).forEach((f) => f()) };
}

describe("downloadBytes", () => {
  it("clicks a blob URL with the file name, then revokes it", () => {
    const { env, log, flush } = fakeEnv();
    downloadBytes(new Uint8Array([1, 2, 3]), "out.pdf", "application/pdf", env);
    expect(log).toEqual(["create:application/pdf:3", "click:blob:1:out.pdf"]);
    flush();
    expect(log).toEqual(["create:application/pdf:3", "click:blob:1:out.pdf", "revoke:blob:1"]);
  });

  it("revokes every URL, one per download", () => {
    const { env, log, flush } = fakeEnv();
    downloadBytes(new Uint8Array([1]), "a.pdf", "application/pdf", env);
    downloadBytes(new Uint8Array([2]), "b.pdf", "application/pdf", env);
    flush();
    expect(log.filter((l) => l.startsWith("revoke"))).toEqual(["revoke:blob:1", "revoke:blob:2"]);
  });
});

describe("formatBytes", () => {
  it("uses B, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("zipStore", () => {
  it("writes a valid stored zip whose entries can be found by name", () => {
    const zip = zipStore([
      { name: "page-1.png", bytes: new Uint8Array([1, 2, 3]) },
      { name: "page-2.png", bytes: new Uint8Array([4, 5]) },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const text = new TextDecoder("latin1").decode(zip);
    expect(text).toContain("page-1.png");
    expect(text).toContain("page-2.png");
    // CRC-32 of [1,2,3] is 0x55bc801d.
    expect(view.getUint32(14, true)).toBe(0x55bc801d);
  });
});
