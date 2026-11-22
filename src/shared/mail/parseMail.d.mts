import type { Email } from "postal-mime";

export interface ParsedMail {
  /** The message as it arrived (the fallback text when it could not be taken apart). */
  raw: string;
  mail: Email | null;
  /** Why the message could not be taken apart (postal-mime's error code), or null. */
  failed: string | null;
}

export declare const MIME_LIMITS: Readonly<{
  maxNestingDepth: number;
  maxPartCount: number;
  maxHeadersSize: number;
  maxRfc822NestingDepth: number;
  maxForwardedAddresses: number;
}>;
export declare const mimeParseCount: { n: number };
export declare function parseMail(raw: string): Promise<ParsedMail>;
