export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export function gmailPayloadText(part: GmailPart, loadPart: (id: string) => Promise<string>): Promise<string>;
