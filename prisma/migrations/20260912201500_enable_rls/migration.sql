-- Enable Row Level Security on every table in the public schema, closing
-- a real gap flagged by Supabase's own security advisor as Critical:
-- Supabase auto-exposes every `public` schema table through its
-- PostgREST data API (and GraphQL/Realtime) using the `anon` and
-- `authenticated` Postgres roles, REGARDLESS of whether the app is coded
-- to use that API. This app never uses it (Prisma connects directly over
-- DATABASE_URL/DIRECT_URL as the table-owning role, never through
-- Supabase's client SDK or a browser-held anon key), but leaving RLS off
-- means anyone who ever obtained this project's anon key could read or
-- write every row in every table directly, completely bypassing the
-- tenant-isolation chokepoint this app's whole security model depends on
-- (src/server/tenant.ts — see its own header comment).
--
-- Deliberately ENABLE, not FORCE, and deliberately zero policies:
--   - ENABLE ROW LEVEL SECURITY alone does not restrict the table OWNER
--     (the role that created these tables, which is also the role Prisma
--     connects as over DATABASE_URL/DIRECT_URL) -- so the app's own
--     access is completely unaffected by this migration.
--   - FORCE ROW LEVEL SECURITY would additionally restrict the owner too,
--     which we do NOT want (that would break the app itself, since there
--     are no policies defined and Prisma has no Postgres-level "current
--     user" concept to write policies against in the first place -- this
--     app enforces tenant isolation once, in the application layer, not
--     twice via a redundant, harder-to-keep-in-sync Postgres policy
--     layer).
--   - With RLS enabled and zero policies, every NON-owner role (`anon`,
--     `authenticated`, and anyone else Supabase's API might use) gets
--     ZERO rows and ZERO write access to these tables, full stop -- which
--     is exactly right: nobody should ever reach this data except through
--     this app's own server-side code.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "two_factor_backup_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_category_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- NOTE (added 2026-09-13, during Phase C): the statements above originally
-- hardcoded the "public" schema (e.g. `ALTER TABLE "public"."users" ...`).
-- That's wrong for a schema-scoped deploy: Prisma's migration engine sets
-- the connection's search_path to whatever schema the URL specifies (this
-- is why every CREATE TABLE / ADD CONSTRAINT elsewhere in this repo's
-- migrations is already unqualified), so a hardcoded "public" prefix
-- silently ALTERs the dev tables no matter which schema you're actually
-- migrating — discovered when deploying a fresh "production" schema
-- during Phase C: this migration "succeeded" but had enabled RLS on the
-- "public" tables (again, harmlessly) instead of the new "production"
-- ones, which then had to be fixed by hand. Unqualified now, so a replay
-- against any schema affects that schema's own tables, as intended.
--
-- NOTE (added 2026-09-12, during Phase J): this file originally also ran
-- `ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;`
-- here. That statement was REMOVED from this historical file (though it
-- did already run against the real dev database, which still has RLS
-- enabled on _prisma_migrations today — editing this file does not
-- undo that) because it broke `prisma migrate dev`'s shadow-database
-- replay for every migration created afterward: Prisma's migration
-- engine reads/writes its own bookkeeping table during shadow-db
-- validation, and once RLS was enabled on it (even zero-policy ENABLE,
-- which does not restrict the table owner on the REAL database), the
-- shadow database's throwaway instance of that same table stopped being
-- queryable by the engine mid-replay, failing with
-- "P3006 / P1014: The underlying table for model
-- `public._prisma_migrations` does not exist." Root-caused and
-- confirmed by reproducing with/without this line during Phase J.
-- `_prisma_migrations` is Prisma's own tooling table, not part of this
-- app's data model, so leaving RLS off it in future fresh environments
-- is an acceptable trade for keeping `migrate dev` working.
