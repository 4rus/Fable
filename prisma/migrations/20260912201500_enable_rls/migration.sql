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

ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."two_factor_backup_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."bank_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."merchant_category_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

-- Prisma's own internal migration-history table -- same reasoning: no
-- reason for it to be reachable via the API either.
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
