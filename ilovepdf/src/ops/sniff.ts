// Kept free of imports so the app shell can check a file without loading pdf-lib.

/** A PDF starts with `%PDF-`, allowing some junk before it as readers do. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}
