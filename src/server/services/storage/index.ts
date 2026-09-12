import "server-only";
import { writeLocal, readLocal, deleteLocal } from "./localDisk";
import { writeSupabase, readSupabase, deleteSupabase, isSupabaseStorageConfigured } from "./supabaseStorage";

/**
 * PROVIDER-AGNOSTIC STORAGE — the domain layer everything outside
 * src/server/services/storage/ should call (currently only
 * src/server/services/attachments.ts). Mirrors the same isolation
 * pattern as src/server/services/bank/: only supabaseStorage.ts is
 * allowed to import `@supabase/supabase-js`.
 *
 * There are two things going on here, deliberately kept separate:
 *  1. `currentStorageProvider()` — which backend a NEW upload should use,
 *     decided once from current environment config.
 *  2. `writeFile`/`readFile`/`deleteFile` — always take an explicit
 *     `provider` argument and dispatch on it, never on current config.
 *     Every Attachment row records which provider it was actually
 *     written to (see prisma/schema.prisma), so reading/deleting an old
 *     file always uses the backend it's really sitting on, even after
 *     the app's active provider changes. Never assume "provider" from
 *     current config when a specific file's own recorded provider is
 *     available.
 */

export type StorageProvider = "local" | "supabase";

/** Which backend a brand-new upload should go to, decided once from
 * current environment config: Supabase Storage if configured (the
 * real, production-ready path), local disk otherwise (the dev
 * default — see localDisk.ts). */
export function currentStorageProvider(): StorageProvider {
  return isSupabaseStorageConfigured() ? "supabase" : "local";
}

export async function writeFile(provider: StorageProvider, storageKey: string, buffer: Buffer, contentType: string): Promise<void> {
  if (provider === "supabase") return writeSupabase(storageKey, buffer, contentType);
  return writeLocal(storageKey, buffer);
}

export async function readFile(provider: StorageProvider, storageKey: string): Promise<Buffer> {
  if (provider === "supabase") return readSupabase(storageKey);
  return readLocal(storageKey);
}

export async function deleteFile(provider: StorageProvider, storageKey: string): Promise<void> {
  if (provider === "supabase") return deleteSupabase(storageKey);
  return deleteLocal(storageKey);
}
