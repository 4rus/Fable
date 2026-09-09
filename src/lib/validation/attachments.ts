/**
 * Upload constraints enforced server-side. Never trust a client-reported
 * MIME type or file extension alone — see attachments.ts, which sniffs the
 * real file content against these magic bytes before accepting anything.
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_ATTACHMENT_TYPES = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
} as const;

export type AllowedAttachmentType = keyof typeof ALLOWED_ATTACHMENT_TYPES;

/** Sniffs a buffer's real content against known magic-byte signatures.
 * Returns the detected MIME type, or null if it doesn't match anything we
 * accept — regardless of what extension or Content-Type the upload
 * claimed. This is the actual security boundary; the allowlist above is
 * data, this function is the check. */
export function sniffAttachmentType(buffer: Buffer): AllowedAttachmentType | null {
  for (const [mime, signatures] of Object.entries(ALLOWED_ATTACHMENT_TYPES) as [
    AllowedAttachmentType,
    readonly (readonly number[])[],
  ][]) {
    for (const signature of signatures) {
      if (buffer.length >= signature.length && signature.every((byte, i) => buffer[i] === byte)) {
        return mime;
      }
    }
  }
  return null;
}

/** Strips path separators and other characters that would let a filename
 * escape its intended directory or confuse a downstream renderer —
 * defense in depth on top of the fact that we never actually use the
 * client filename to build a filesystem path (see attachments.ts).
 *
 * Also strips control characters (CR/LF and other C0/C1 codes). This
 * filename is later embedded in a Content-Disposition response header
 * (see the attachments download route) — Node rejects header values
 * containing raw CR/LF outright, which would otherwise turn an oddly-
 * named upload into a 500 on every future download of it, and stripping
 * them here closes off any theoretical header-injection vector too. */
export function sanitizeFilename(name: string): string {
  const base = name
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .trim();
  return base.slice(0, 200) || "attachment";
}
