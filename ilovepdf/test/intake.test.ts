import { describe, expect, it } from "vitest";
import { IntakeCancelled, readPdfFile } from "../src/ui/intake.ts";
import { makePdf } from "./helpers.ts";

/** A scripted password prompt: answers in order and records the error shown each time. */
function prompts(...answers: (string | null)[]) {
  const shown: (string | undefined)[] = [];
  const ask = async (_name: string, error?: string) => {
    shown.push(error);
    return answers.shift() ?? null;
  };
  return { ask, shown };
}

describe("readPdfFile", () => {
  it("loads a plain PDF without asking for a password", async () => {
    const p = prompts();
    const r = await readPdfFile("a.pdf", await makePdf(3), p.ask);
    expect(r.pageCount).toBe(3);
    expect(p.shown).toEqual([]);
  });

  it("asks for a password, re-prompts with an error on a wrong one, and loads with the right one", async () => {
    const p = prompts("wrong", "s3cret");
    const r = await readPdfFile("locked.pdf", await makePdf(2, { encryptWith: "s3cret" }), p.ask);
    expect(p.shown).toEqual([undefined, "That password does not open this PDF."]);
    expect(r.pageCount).toBe(2);
    expect(r.wasEncrypted).toBe(true);
  });

  it("cancelling the prompt gives up on the file", async () => {
    const p = prompts(null);
    await expect(readPdfFile("locked.pdf", await makePdf(1, { encryptWith: "x" }), p.ask)).rejects.toBeInstanceOf(
      IntakeCancelled,
    );
  });

  it("rejects a file that is not a PDF, naming the file and the reason", async () => {
    const p = prompts();
    await expect(readPdfFile("notes.txt", new TextEncoder().encode("hello"), p.ask)).rejects.toThrow(
      /notes\.txt: this file is not a pdf/i,
    );
  });
});
