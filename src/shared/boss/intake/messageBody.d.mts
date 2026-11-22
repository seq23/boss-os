/**
 * Types for Boss OS's MIME body reader.
 *
 * A `.mjs` beside a `.d.mts` for the same load-bearing reason as `mail.d.mts`: the Worker imports it
 * to build the task body, and `scripts/validate/a-task-body-is-not-a-mime-message.mjs` imports the
 * SAME function to prove the body it produces carries no headers. A guard with its own copy of the
 * extraction rule would prove only that its copy works.
 */

import type { ParsedMail } from "../../mail/parseMail.mjs";

/** "unparsed": the message could not be taken apart, and its raw text after the headers is the body. */
export type BodyFormat = "plain" | "html" | "none" | "unparsed";

export interface ReadableText {
  /** The decoded, human-readable text of the message. Empty when no text part could be read. */
  text: string;
  format: BodyFormat;
  /** How many parts the message had (its text bodies and its files). 0 when it could not be parsed. */
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

export declare function htmlToText(html: string): string;
export declare function readableText(source: string | ParsedMail, options?: { full?: boolean }): Promise<ReadableText>;
export declare function stripSignature(text: string): string;
export declare const QUOTE_START: RegExp;
export declare function ownWords(text: string | null | undefined): string;
export declare function taskBodyFrom(source: string | ParsedMail): Promise<TaskBody>;
export declare function mimeTellsIn(body: string | null | undefined): string[];
