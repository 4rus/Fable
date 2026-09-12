import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SUPABASE STORAGE BACKEND — the real, production-ready home for
 * attachments once `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
 * configured (see README "Deployment"). This is the ONLY file allowed to
 * import `@supabase/supabase-js` — everything outside
 * src/server/services/storage/ talks to the provider-agnostic functions
 * in index.ts, same isolation pattern as src/server/services/bank/
 * plaidClient.ts.
 *
 * SECURITY: the bucket is created PRIVATE (never public) and every
 * operation here uses the SERVICE ROLE key, which bypasses Storage's own
 * RLS entirely — that's deliberate, not a shortcut: this app's tenant
 * isolation is enforced once, in the application layer (every call here
 * is reached only through attachments.ts, which already verified the
 * caller's businessId owns the row), not duplicated as a second,
 * parallel set of Storage-level policies that could drift out of sync
 * with it. The service role key must NEVER be sent to the client or used
 * anywhere outside this server-only module.
 */

const BUCKET = "attachments";

export function isSupabaseStorageConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Supabase Storage is not configured.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Bucket existence is checked at most once per server process (not once
// per upload) -- cheap enough to matter under real traffic, and a bucket
// created out-of-band (e.g. by a future infra script) is still detected
// correctly since this only ever creates one if it's genuinely missing.
let bucketEnsured = false;

async function ensureBucket(client: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  const { data: existing } = await client.storage.getBucket(BUCKET);
  if (!existing) {
    const { error } = await client.storage.createBucket(BUCKET, { public: false });
    // A concurrent request may have created it first between getBucket and
    // here -- "already exists" is success, not a real failure.
    if (error && !/already exists/i.test(error.message)) {
      throw error;
    }
  }
  bucketEnsured = true;
}

export async function writeSupabase(storageKey: string, buffer: Buffer, contentType: string): Promise<void> {
  const client = getClient();
  await ensureBucket(client);
  const { error } = await client.storage.from(BUCKET).upload(storageKey, buffer, {
    contentType,
    upsert: false, // storageKey always includes a fresh randomUUID() -- a collision would mean something is wrong, never silently overwrite
    // Supabase Storage defaults to Cache-Control: max-age=3600, which a
    // CDN edge can go on serving for up to an hour after the object is
    // deleted -- confirmed directly against the real API while building
    // this. Harmless for the app's own access path (every read goes
    // through attachments.ts, which checks the Attachment DB row first
    // and never even reaches here once that row is gone) but wrong for
    // data this sensitive to leave cacheable anywhere outside our own
    // control. Matches the no-cache header the download route already
    // sets on the final response (src/app/api/attachments/[id]/route.ts).
    cacheControl: "0",
  });
  if (error) throw error;
}

export async function readSupabase(storageKey: string): Promise<Buffer> {
  const client = getClient();
  const { data, error } = await client.storage.from(BUCKET).download(storageKey);
  if (error || !data) throw error ?? new Error("Empty response from Supabase Storage");
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteSupabase(storageKey: string): Promise<void> {
  const client = getClient();
  await client.storage.from(BUCKET).remove([storageKey]).catch(() => {});
}
