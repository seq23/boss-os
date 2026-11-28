import { htmlToText } from "../intake/messageBody.mjs";

/** Decode Gmail full-format MIME, keeping quoted and inline forwarded text. */
export async function gmailPayloadText(part, loadPart) {
  if (part.filename) return "";
  if (part.mimeType === "text/plain" || part.mimeType === "text/html" || part.mimeType === "message/delivery-status") {
    const data = part.body?.data ?? (part.body?.attachmentId ? await loadPart(part.body.attachmentId) : null);
    if (!data && part.body?.size) throw new Error("Gmail omitted readable message text");
    const text = new TextDecoder().decode(Uint8Array.from(atob((data ?? "").replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)));
    return part.mimeType === "text/html" ? htmlToText(text) : text;
  }
  const values = [];
  for (const child of part.parts ?? []) {
    const text = await gmailPayloadText(child, loadPart);
    if (part.mimeType === "multipart/alternative" && child.mimeType === "text/plain" && text) return text;
    if (text) values.push(text);
  }
  return part.mimeType === "multipart/alternative" ? (values[0] ?? "") : values.join("\n");
}
