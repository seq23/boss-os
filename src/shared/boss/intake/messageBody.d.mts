/**
 * Types for Boss OS's MIME body reader.
 *
 * A `.mjs` beside a `.d.mts` for the same load-bearing reason as `mail.d.mts`: the Worker imports it
 * to build the task body, and `scripts/validate/a-task-body-is-not-a-mime-message.mjs` imports the
 * SAME function to prove the body it produces carries no headers. A guard with its own copy of the
 * extraction rule would prove only that its copy works.
 */

export type BodyFormat = "plain" | "html" | "none";

export interface ReadableText {
  /** The decoded, human-readable text of the message. Empty when no text part could be read. */
  text: string;
  format: BodyFormat;
  /** How many MIME leaves were walked. 1 for a message that is not multipart. */
  parts: number;
}

export interface TaskBody {
  /** What goes on the work card: readable, signature and quoted reply removed. */
  body: string;
  format: BodyFormat;
  parts: number;
  /** The same text with the signature still on it, for anything that wants the whole message. */
  readable: string;
}

export declare const MAX_READABLE_BYTES: number;
export declare const MIME_TELLS: ReadonlyArray<{ name: string; test: RegExp }>;

export declare function decodeQuotedPrintable(text: string): string;
export declare function decodeBase64Text(text: string): string;
export declare function htmlToText(html: string): string;
export declare function readableText(raw: string): ReadableText;
export declare function stripSignature(text: string): string;
export declare function taskBodyFrom(raw: string): TaskBody;
export declare function mimeTellsIn(body: string | null | undefined): string[];
