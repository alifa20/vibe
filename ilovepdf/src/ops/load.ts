import { PDFArray, PDFDict, PDFDocument, PDFObject, PDFRef, PDFStream } from "@cantoo/pdf-lib";
import type { PdfSource } from "./types.ts";

/** The file is encrypted and no password was given. */
export class PasswordRequiredError extends Error {
  override name = "PasswordRequiredError";
  constructor() {
    super("Password required: this PDF is protected.");
  }
}

/** A password was given but does not open the file. */
export class WrongPasswordError extends Error {
  override name = "WrongPasswordError";
  constructor() {
    super("That password does not open this PDF.");
  }
}

/** The bytes are not a PDF, or are too damaged to read. */
export class NotAPdfError extends Error {
  override name = "NotAPdfError";
}

export const sourceBytes = (src: PdfSource): Uint8Array => (src instanceof Uint8Array ? src : src.bytes);
const sourcePassword = (src: PdfSource): string | undefined => (src instanceof Uint8Array ? undefined : src.password);

/** A PDF starts with `%PDF-`, allowing some junk before it as readers do. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

// pdf-lib's errors are compiled to ES5 classes, so `instanceof` on them is unreliable: match messages.
const isWrongPassword = (e: unknown) => e instanceof Error && /password incorrect|needs password/i.test(e.message);
const isEncrypted = (e: unknown) => e instanceof Error && /is encrypted/i.test(e.message);

/**
 * pdf-lib drops /Encrypt from the trailer of a decrypted document, but the encryption
 * dictionary, the old cross-reference stream (which repeats /Encrypt) and the unpacked object
 * streams stay behind as objects. A re-saved file would then look encrypted to the next
 * reader, so keep only what the trailer can reach.
 */
function dropUnreachableObjects(doc: PDFDocument): void {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter((o): o is PDFObject => !!o);
  while (stack.length) {
    let obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const target = ctx.lookup(obj);
      if (!target) continue;
      obj = target;
    }
    if (obj instanceof PDFStream) stack.push(obj.dict);
    else if (obj instanceof PDFDict) stack.push(...obj.values());
    else if (obj instanceof PDFArray) stack.push(...obj.asArray());
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref);
}

async function loadWith(bytes: Uint8Array, password: string | undefined): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, password === undefined ? {} : { password });
  } catch (e) {
    if (isEncrypted(e) || isWrongPassword(e)) throw e;
    throw new NotAPdfError(`This file could not be read as a PDF (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/**
 * Open a PDF for editing. An encrypted file is decrypted with its password; a file that is
 * only owner-protected (empty user password) opens without one. A decrypted document has
 * its encryption dictionary removed, so saving it writes an unencrypted file.
 */
export async function openPdf(src: PdfSource): Promise<PDFDocument> {
  return (await open(src)).doc;
}

async function open(src: PdfSource): Promise<{ doc: PDFDocument; wasEncrypted: boolean }> {
  const bytes = sourceBytes(src);
  const password = sourcePassword(src);
  if (!looksLikePdf(bytes)) throw new NotAPdfError("This file is not a PDF.");
  try {
    return { doc: await loadWith(bytes, undefined), wasEncrypted: false };
  } catch (e) {
    if (!isEncrypted(e)) throw e;
  }
  try {
    const doc = await loadWith(bytes, password ?? "");
    dropUnreachableObjects(doc);
    return { doc, wasEncrypted: true };
  } catch (e) {
    if (!isWrongPassword(e)) throw e;
    throw password === undefined ? new PasswordRequiredError() : new WrongPasswordError();
  }
}

/**
 * Check a file once when it is added: count its pages and, if it was encrypted, return
 * unencrypted bytes so later steps (and pdf.js) never need the password again.
 */
export async function unlockPdf(
  src: PdfSource,
  password?: string,
): Promise<{ bytes: Uint8Array; pageCount: number; wasEncrypted: boolean }> {
  const { doc, wasEncrypted } = await open(password === undefined ? src : { bytes: sourceBytes(src), password });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new NotAPdfError("This PDF has no pages.");
  return { bytes: wasEncrypted ? await doc.save() : sourceBytes(src), pageCount, wasEncrypted };
}
