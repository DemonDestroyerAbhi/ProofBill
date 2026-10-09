/** Turns an uploaded contract (PDF / DOCX / text / markdown / email) into plain text for extraction. */
export async function documentToText(name: string, bytes: Uint8Array): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || isPdf(bytes)) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return normalise(text);
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return normalise(value);
  }
  return normalise(new TextDecoder("utf-8").decode(bytes));
}

function isPdf(b: Uint8Array): boolean {
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}

function normalise(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/ /g, " ").replace(/\n{4,}/g, "\n\n\n").trim();
}
