import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { getAttachmentForDownload, InvalidFileError } from "@/server/services/attachments";
import { ForbiddenError, UnauthenticatedError } from "@/server/tenant";
import { logError } from "@/lib/logger";

/**
 * The ONLY way to read an uploaded file. There is no public/static path to
 * `uploads/` — every request here re-derives the caller's businesses from
 * their session and only serves the attachment if it belongs to one of
 * them. Never trust the :id in the URL beyond "this is a candidate to
 * check ownership of," exactly like every other tenant-scoped lookup in
 * this app.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }

  const businesses = await getMyBusinesses(userId);

  for (const business of businesses) {
    try {
      const { buffer, mimeType, filename } = await getAttachmentForDownload(business.id, id);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": mimeType,
          // "inline" so a browser previews images/PDFs rather than forcing
          // a download; filename is sanitized at upload time (see
          // sanitizeFilename), not reflected here unescaped.
          "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    } catch (err) {
      if (err instanceof ForbiddenError) continue; // not in this business — try the next one
      if (err instanceof InvalidFileError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      logError("attachment download failed", err, { attachmentId: id });
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  }

  // Exhausted every business the caller belongs to without a match —
  // same 404 whether the attachment doesn't exist or belongs to someone
  // else entirely, so this endpoint can't be used to probe for existence.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
