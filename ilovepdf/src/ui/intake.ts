// Reading a dropped or picked PDF: detect encryption, ask for the password until it is
// right or the user cancels, and keep unencrypted bytes from then on.
import { PasswordRequiredError, WrongPasswordError, unlockPdf } from "../ops/load.ts";

/** The user closed the password prompt; the file should be removed, quietly. */
export class IntakeCancelled extends Error {
  override name = "IntakeCancelled";
}

/** Shows the password prompt for `fileName`, with `error` when the last try was wrong. Null = cancel. */
export type AskPassword = (fileName: string, error?: string) => Promise<string | null>;

export interface ReadPdf {
  bytes: Uint8Array;
  pageCount: number;
  wasEncrypted: boolean;
}

export async function readPdfFile(fileName: string, bytes: Uint8Array, ask: AskPassword): Promise<ReadPdf> {
  let password: string | undefined;
  let error: string | undefined;
  for (;;) {
    try {
      return await unlockPdf(bytes, password);
    } catch (e) {
      if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
        if (e instanceof WrongPasswordError) error = e.message;
        const answer = await ask(fileName, error);
        if (answer === null) throw new IntakeCancelled(fileName);
        password = answer;
        continue;
      }
      throw new Error(`${fileName}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
}
