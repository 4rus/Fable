import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * LOCAL DISK BACKEND — the original (and still the dev-default) storage
 * for uploaded attachments. Does NOT survive a redeploy and does not work
 * past a single instance (see README "Deployment") — this is why
 * src/server/services/storage/supabaseStorage.ts exists. Kept as a real,
 * working backend (not deleted) because it's still exactly right for a
 * single-instance local dev loop with no cloud credentials configured —
 * see index.ts for how the two are selected.
 */

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

export async function writeLocal(storageKey: string, buffer: Buffer): Promise<void> {
  const absolutePath = path.join(UPLOAD_ROOT, storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
}

export async function readLocal(storageKey: string): Promise<Buffer> {
  return readFile(path.join(UPLOAD_ROOT, storageKey));
}

export async function deleteLocal(storageKey: string): Promise<void> {
  await unlink(path.join(UPLOAD_ROOT, storageKey)).catch(() => {});
}
