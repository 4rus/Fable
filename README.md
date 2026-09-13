# Fable

Financial visibility software for small business owners who aren't accountants.
Instead of a ledger, Fable tells you what changed in your business, why, and
what to do about it — grounded entirely in your own transactions.

## Product thesis (why this exists)

See the Product Thesis discussed in project history: the differentiator is
**interpretation, not automation**. Every insight the app shows is
deterministic arithmetic over real rows in your database (see
`src/server/services/insights.ts` and `forecast.ts`) — never an LLM guess.
An AI narration layer (Phase J, see "AI narration layer" below) exists on
top of that, and its only job is turning that structured, already-correct
data into friendlier prose. It is never allowed to invent a number or a
conclusion of its own — every generated sentence is checked against the
real numbers it was given, and falls back to the plain deterministic text
on any doubt.

## Stack

- **Next.js 14→15 (App Router) + TypeScript** — server actions/route handlers
  are the only place mutations happen; no separate API layer.
- **Prisma + Postgres** (Supabase in this environment, via its Supavisor
  pooler) — see "Database" below. Dev, staging, and prod all run the same
  provider now; there is no SQLite fallback.
- **Auth.js (NextAuth) v4, credentials + bcrypt, JWT sessions.**
- **Zod** at every server-side input boundary.
- **Tailwind**, Fraunces (serif, for anything the product "says") + Inter
  (UI chrome) — see `tailwind.config.ts` and `src/app/globals.css` for the
  full design system and the reasoning behind it.
- **Vitest** for unit/integration tests, **Playwright** for end-to-end tests.

No microservices, no queue, no separate API gateway. One deployable.

## Setup

```bash
npm install
cp .env.example .env        # fill in a real Postgres project's details (see below)
npm run db:migrate          # applies migrations to your DATABASE_URL/DIRECT_URL
npm run db:seed             # wipes and reseeds a realistic demo business
npm run dev
```

Demo login after seeding: `demo@example.com` / `demo-password-123`.
**Reseeding wipes all data and invalidates any active session** — sign in
again afterward.

### Environment variables

See `.env.example` for the full list with comments. The ones that matter:

- `DATABASE_URL` / `DIRECT_URL` — a Postgres project (this environment uses
  Supabase). `DATABASE_URL` is the pooled connection the app queries at
  runtime; `DIRECT_URL` is the session-mode connection migrations use. See
  the comment in `.env.example` for exactly where to find both in
  Supabase's dashboard (Connect -> ORM -> Prisma) — the direct
  `db.<ref>.supabase.co` host is IPv6-only on new projects and won't be
  reachable from an IPv4-only network; the pooler exists to work around
  exactly that.
- `NEXTAUTH_SECRET` — generate with `npx auth secret` or `openssl rand -base64 32`.
  Never commit this. Rotating it invalidates every existing session.
- `ENCRYPTION_KEY`, `RESEND_API_KEY` / `EMAIL_FROM` — see the comments in
  `.env.example`; both are optional for local dev (2FA and email sending
  degrade to honest fallback behavior without them, see "Security model").
- `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` — free Sandbox
  credentials from https://dashboard.plaid.com, no business verification
  required. See "Bank connectivity" below.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — optional; without them,
  attachment uploads use local disk (fine for dev, not for production —
  see "Deployment"). See the comments in `.env.example`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / run |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Run the Playwright end-to-end suite (starts its own dev server) |
| `npm run db:migrate` | Apply Prisma migrations (dev) |
| `npm run db:seed` | Wipe and reseed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run lint` | ESLint |

## Architecture

```
src/
  app/                     Routes (App Router). Pages are server components
                           that call server/services/* directly — no fetch
                           round-trip to your own API for reads.
  app/page.tsx             The public marketing homepage (logged-out
                           visitors; redirects to /app if already signed
                           in). Shares the same design tokens as the app —
                           see components/marketing/.
  app/login, app/signup,
  app/forgot-password,
  app/reset-password       Authentication screens, all built on the
                           shared components/marketing/AuthShell split
                           layout rather than a bare centered card.
  app/*/[...]              Client components only where interactivity is
                           needed (forms, the sidebar, insight disclosures).
  components/marketing/    Public-site-only UI: nav, footer, the auth
                           shell, and the homepage's product preview
                           (a static illustration styled identically to
                           the real Overview page — not a generic mockup).
  server/
    tenant.ts              THE authorization chokepoint. Every business-
                           scoped read/write goes through requireMembership()
                           or requireOwner() — see below.
    actions/*.ts           "use server" mutations, called from forms/buttons.
    services/*.ts          Domain logic: invoices, payments, forecast,
                           insights, team management, attachments, CSV
                           import. This is where the actual business
                           rules live, independent of HTTP.
  lib/
    money.ts               The ONLY module that does money math. Integer
                           cents everywhere; never a float.
    totp.ts                Hand-rolled TOTP (RFC 6238) for two-factor auth
                           — no dependency, unit-tested against RFC 4226's
                           official vectors.
    crypto.ts               AES-256-GCM encrypt/decrypt for secrets that
                           must be read back in plaintext (2FA secrets
                           today; bank-provider tokens once Phase E lands).
    validation/*.ts        Zod schemas for every server-side input boundary.
    types.ts               Enum-shaped string unions (see "Database" below
                           for why these are strings, not Prisma enums).
  components/              Shared UI: Sidebar, ThingsToDo, StatusChip, icons.
prisma/
  schema.prisma            Heavily commented — read the header before
                           changing anything. Documents the cash-basis
                           accounting decision and the money/tenancy rules.
  seed.ts                  Realistic demo data (a small cleaning company),
                           not "Test Customer 1" placeholders.
tests/
  *.test.ts                Vitest: money math, invoice/payment logic,
                            forecast determinism, tenant isolation, team
                            management. Run against an isolated "test"
                            Postgres schema (same project, never your
                            "public" dev data) — see "Testing" below for
                            why, now that Postgres is the only provider.
e2e/
  *.spec.ts                Playwright: full-stack critical user journeys
                            (signup through payment, plus attachment
                            upload/download and CSV import) against a
                            real running server + real database.
uploads/                   Local disk storage backend for attachment
                           files (src/server/services/storage/) — the
                           dev default; switches to real Supabase
                           Storage automatically once SUPABASE_URL /
                           SUPABASE_SERVICE_ROLE_KEY are set. See
                           "Deployment".
```

## Security model

**Tenant isolation.** Every business-owned table carries `businessId`
directly. Every request that touches business data calls
`requireMembership(businessId)` (from `src/server/tenant.ts`), which
re-derives the caller's access from their session — **the `businessId` a
client sends is always treated as an unauthenticated candidate to check,
never as ground truth.** This is tested explicitly in
`tests/tenant-isolation.test.ts`, including the specific case of a
real, logged-in user who knows another business's real database ID.

**Authentication vs. authorization.** `requireUser()` answers "who are
you?" `requireMembership()` / `requireOwner()` answer "are you allowed to
touch this specific business?" They are separate calls on purpose —
never assume a valid session implies access to a specific resource.

**Row Level Security (defense in depth against a different attack
surface).** Tenant isolation above is enforced once, in the application
layer — this app never relies on Postgres RLS for it, and there are no
per-tenant RLS policies to keep in sync with `tenant.ts`. But Supabase
auto-exposes every table in the `public` schema through its own
PostgREST/GraphQL/Realtime API using the `anon`/`authenticated` Postgres
roles, independent of whether an app is written to use that API — this
app isn't (Prisma connects directly over `DATABASE_URL`/`DIRECT_URL` as
the table-owning role), but leaving RLS off would still mean anyone who
ever obtained this project's `anon` key could read or write every row in
every table directly, bypassing this app's authorization entirely. Every
table in `public` has `ROW LEVEL SECURITY` enabled with zero policies
(see the `enable_rls` migration) — `ENABLE`, not `FORCE`, so the
owning/Prisma role is completely unaffected (Postgres exempts a table's
owner from RLS by default), while every other role gets zero rows and
zero write access, full stop.

**Money.** Integer cents only (`src/lib/money.ts`). Line item and invoice
totals are always recomputed server-side from `quantity * unitPriceCents`
— a client-sent total is never trusted. Payments carry a required
`idempotencyKey` with a unique DB constraint, so a network retry can't
double-record money (tested in `tests/invoices.test.ts`). An invoice can
never accept more in payments than its total (`OverpaymentError`).

**Rate limiting.** Login and signup are rate-limited per IP+identifier
(`src/lib/rate-limit.ts`) — real Upstash Redis when `UPSTASH_REDIS_REST_URL`/
`UPSTASH_REDIS_REST_TOKEN` are set (Phase Q), so the limit is enforced
correctly across Vercel's multiple serverless function instances, not
just within one. Falls back to an honest in-memory counter without
those set (fine for local dev; genuinely NOT a real brute-force
protection once deployed to more than one instance — see the module's
own comment for why). Verified against real Upstash Redis in
`tests/rate-limit.test.ts`.

**File uploads** (expense receipts, invoice attachments): validated by
actual content sniffing (not just the claimed MIME type or extension),
size-capped, stored under a per-tenant path, and only ever served through
an authorization-checked route — never a public/guessable URL. Filenames
are also stripped of control characters (`src/lib/validation/attachments.ts`)
before being embedded in the download route's `Content-Disposition`
header. See `src/server/services/attachments.ts`.

**HTTP security headers** (`next.config.mjs`, applied to every response):
`X-Frame-Options: DENY` and a `Content-Security-Policy` with
`frame-ancestors 'none'` (clickjacking), `X-Content-Type-Options: nosniff`
(MIME sniffing), `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` disabling camera/mic/geolocation, and HSTS. The CSP's
`script-src`/`style-src` need `'unsafe-inline'` because the App Router
injects its own inline RSC-hydration `<script>` tags — tightening that to
a nonce-based CSP (via `middleware.ts` generating a per-request nonce) is
real follow-up work, not done yet. `'unsafe-eval'` is added to `script-src`
in development only (`next dev`'s webpack HMR needs it); the production
CSP does not include it.

**Security audit log.** Beyond the ephemeral stdout structured logger
(`src/lib/logger.ts`), sensitive account/business events are written to
the durable `AuditLog` table: business creation, team member add/revoke,
payment recording, and password resets (`action: "auth.password_reset"`,
no token/password material in the row). Query it per-user or per-business
for security review rather than grepping logs.

**Known dependency vulnerabilities (audited, deferred):** `npm audit`
currently reports issues in `esbuild`/`vite` (via `vitest`'s dev-server
bundling) and `postcss` (bundled inside `next`'s own build pipeline).
Both are **build-time-only** tooling dependencies, not runtime code paths
an attacker hitting the deployed app could reach — fixing them requires a
major-version bump (Vitest 5, Next 16) that deserves its own dedicated,
tested upgrade pass rather than being folded into a security review.

**Two-factor authentication (TOTP)** is real, not mocked — and hand-rolled
rather than a dependency (`src/lib/totp.ts`), the same way `src/lib/money.ts`
owns money math directly instead of reaching for a library. Compatible
with any standard authenticator app (SHA-1, 6 digits, 30s step). The
secret is encrypted at rest (`src/lib/crypto.ts`, AES-256-GCM, key from
`ENCRYPTION_KEY`) since verifying a code needs the plaintext back, unlike
a password. 10 single-use backup codes (SHA-256-hashed) are issued on
enrollment for recovery if the authenticator device is lost. Login is a
two-step flow: `checkCredentialsAction` verifies the password first
(sharing the exact same rate-limit bucket as the real sign-in, so it
can't be used to dodge brute-force limits) and reports whether a code is
needed; NextAuth's `authorize()` (`src/lib/auth.ts`) independently
re-verifies both password and code together before minting a session —
there is no "logged in but not fully" intermediate session state. See
`src/server/services/twoFactor.ts` and `tests/totp.test.ts` (verified
against the official RFC 4226 test vectors), `tests/two-factor.test.ts`,
and `tests/crypto.test.ts`. Manage it at `/app/settings/security`.

**What is NOT implemented yet, on purpose:** email-based invitations
(adding a team member currently requires them to already have an
account — see the comment in `src/server/services/businesses.ts`),
passkeys/WebAuthn, and account/business deletion. These are real gaps
for a production launch, not oversights — each needs deliberate design
(especially deletion, which has to reconcile "let a user leave" against
"don't destroy financial records that may need retention").

**Password reset** (`src/server/services/password-reset.ts`) is real,
not mocked: a single-use, 30-minute, SHA-256-hashed token is created and
validated server-side, and a successful reset invalidates every other
outstanding token for that user. *Delivery* goes through the shared
email layer below — real if `RESEND_API_KEY` is set, an honest
dev-mode fallback (the link is printed directly on the page, clearly
labeled "Development mode") if not.

**Outbound email** (`src/lib/email.ts`) is a single `sendEmail()` seam
used by both password reset and invoice sending, backed by
[Resend](https://resend.com). Two states, both real — never a fake
"sent!" — see the type it returns: `{ sent: true }` on actual delivery,
or `{ sent: false, reason: "not_configured" | "send_failed" }` when it
isn't. Set `RESEND_API_KEY` (and `EMAIL_FROM`) to turn it on; without a
verified domain, Resend's free tier only delivers to the email on your
own Resend account, which is enough for development but not for real
customers.

**Invoice PDFs + "send invoice"** (`src/lib/pdf/invoice.tsx`,
`src/server/services/invoiceEmail.ts`) are real. "Send by email" on an
invoice renders an actual PDF (`@react-pdf/renderer`, standard fonts —
not the web app's Fraunces/Inter, see the comment in that file for why)
and emails it as an attachment to the customer via the layer above; the
invoice only advances `DRAFT → SENT` on confirmed delivery, never
speculatively. If email isn't configured or the customer has no email
on file, the UI says so plainly and offers "Mark as sent" — a manual,
honest status flip for when the business sent the invoice some other
way — instead of silently failing or lying about delivery.

**CSV import** (`src/server/services/csvImport.ts`) only ever creates
expenses (money out). A positive amount in a bank export is a deposit —
we have no reliable way to know which invoice or customer it belongs to,
and guessing would mean fabricating a link between a real transaction
and a specific customer. Deposit rows are parsed, counted, and surfaced
to the user to match by hand on the Invoices page; they are never
silently dropped and never auto-converted into a Payment.

## Accounting model

This is **cash-basis, single-entry** bookkeeping, not GAAP double-entry
accounting — see the top of `prisma/schema.prisma` for the full reasoning.
We track money in (`Payment`) and money out (`Expense`) against a
manually-entered starting cash balance. There is no chart of accounts, no
debits/credits, no balance sheet. This is a deliberate scope decision, not
a shortcut — it's honest about what it is, and nothing here can silently
drift out of balance the way a half-implemented double-entry system could.

Enum-shaped columns (`Invoice.status`, `Membership.role`, etc.) are plain
`String` in the schema rather than native Postgres/Prisma enums — this
predates the Postgres migration (the schema used to also run on SQLite,
which has no enum type) and was kept deliberately rather than switched
now, since a real enum type is a more invasive migration than the value
it adds here. The allowed values live in `src/lib/types.ts` and are
enforced by the Zod schemas at every write path — never write one of
these columns with a raw string that didn't come through there.

## Testing

Three layers:

1. **Unit** — pure logic with no I/O: `tests/money.test.ts`,
   `tests/validation.test.ts`, `tests/totp.test.ts`, `tests/crypto.test.ts`.
2. **Integration** — service-layer logic against a real database:
   invoices/payments, forecast determinism, insight generation, team
   management, tenant isolation, 2FA, invoice email. This is most of the
   suite, and it's where the financial-correctness and security
   guarantees are actually proven (overpayment rejection, idempotency,
   cross-tenant access denial, the "last owner can't be removed"
   invariant, etc).
3. **End-to-end** (`e2e/`) — Playwright driving a real browser against a
   real running server and real database, covering the critical user
   journeys: sign up → create a customer → create an invoice → record a
   payment → see it reflected as an insight on the dashboard.

**Database isolation, now that Postgres is the only provider:** unit/
integration tests run against a dedicated **`test` Postgres schema**, and
E2E against a dedicated **`e2e` schema** — both live in the same Supabase
project as real dev data (`public` schema) but are fully separate
namespaces, dropped and recreated fresh at the start of every run
(`tests/global-setup.ts`, `e2e/global-setup.ts`) so tests never touch or
depend on real dev data. This replaces the previous "throwaway SQLite
file" isolation — a single Prisma Client can only speak one provider, so
once the real app moved to Postgres, tests had to as well; there's no way
to keep SQLite for tests while Postgres runs everything else. The
honest tradeoff: tests are now real network round-trips (tens of
seconds slower overall than local SQLite was), which is why
`playwright.config.ts` runs with a deliberately generous
`expect: { timeout: 20_000 }` and a 120s overall test timeout — cold
Next.js route compiles stacked on real Postgres latency can legitimately
take longer than SQLite-era defaults assumed, and that's a real
characteristic of this setup, not a flaky test to paper over.

Run `npm test` for (1)+(2), `npm run test:e2e` for (3). CI should run both
before merge; neither currently runs in a CI pipeline because none is
configured yet (there's no `.github/workflows` in this repo) — that's a
real gap, not a hidden assumption.

## Bank connectivity (Phase E)

Real, not a prototype — connected against Plaid's actual Sandbox API
(`tests/bank-connections.test.ts` runs 7 tests against it using
`sandboxPublicTokenCreate`, Plaid's own mechanism for automated testing
without driving the Link UI). What's real vs. what's still ahead:

**Real:** connecting an account (`/app/bank`, Plaid Link), storing the
connection with its access token encrypted at rest
(`accessTokenEncrypted`, AES-256-GCM — see `src/lib/crypto.ts`),
fetching accounts and balances, incremental transaction sync via
`transactions/sync` (idempotent — upserts by `providerTransactionId`,
never inserts a duplicate, persists the sync cursor after every page so
a crash resumes rather than reprocessing), and disconnecting (best-effort
provider-side revoke, then marked `REVOKED` locally — historical
transactions/accounts are kept, not deleted).

**Provider abstraction:** `src/server/services/bank/plaidClient.ts` is
the ONLY file allowed to import the `plaid` package or reference
Plaid-specific types. Everything else — `connections.ts`, the server
actions, the UI — talks in provider-agnostic shapes
(`BankConnection`/`FinancialAccount`/`Transaction`, see the comment
above `BankConnection` in `schema.prisma`). Adding a second provider
(Flinks, etc.) means writing a new adapter file that produces the same
shapes, not touching anything downstream.

**Phase G (transaction categorization/reconciliation)** is also real and
done: a synced `Transaction` gets deterministically categorized (a
business's own learned merchant rules auto-apply; generic keyword
matches are suggestions only, never silently applied) and can be
reconciled into a real `Expense` or matched to an open invoice's
`Payment` — always on explicit user confirmation, never automatically.
See `src/server/services/bank/categorization.ts` and
`reconciliation.ts`, and the "Needs attention" section on `/app/bank`.

**Phase F (real-time sync via webhooks)** is real and done:
`src/app/api/webhooks/plaid/route.ts` receives Plaid's webhooks (mainly
`TRANSACTIONS: SYNC_UPDATES_AVAILABLE`, which triggers the same
`syncBankConnection()` a manual "Sync now" click does; also `ITEM:
ERROR` and revocation-related codes, reflected in the connection's
status) with real JWT signature verification
(`src/server/services/bank/webhookVerification.ts` — ES256 signature,
freshness check, and a SHA-256 body-hash check, all real cryptographic
verification via `jose`, per
[Plaid's webhook verification spec](https://plaid.com/docs/api/webhooks/webhook-verification/)).
Manual "Sync now" still works exactly as before and remains the fallback
when webhooks aren't configured.

**Honest limit on how this was tested:** the signature-verification math
itself is tested for real (valid/tampered/stale/wrong-key cases, using a
locally generated ES256 keypair — see
`tests/webhook-verification.test.ts`), and the dispatch logic is tested
against real Plaid Sandbox connections
(`tests/webhook-handler.test.ts`, `tests/webhook-route.test.ts` —
including a fully signed, real end-to-end POST to the route). What
hasn't been tested is Plaid *actually delivering* a webhook to this
server, because that requires a real public URL and this environment
only has `localhost` — the same category of gap as "not yet deployed"
elsewhere in this doc. Set `PLAID_WEBHOOK_URL` to a real public URL once
deployed to turn this on for real; without it, no webhook is registered
with Plaid and nothing changes from today's manual-sync behavior.

**Not built yet:** a reconnect flow for an errored/expiring connection
(Plaid Link's "update mode") — an `ITEM: ERROR` webhook (or a stale
`LOGIN_REPAIRED`/`PENDING_EXPIRATION`) is reflected in the connection's
status, but there's no UI path yet to actually walk the user back
through Link to fix it; today they'd need to disconnect and reconnect
from scratch. Logged, not silently dropped — see
`webhookHandler.ts`'s comments.

**Environment:** `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` / the
optional `PLAID_WEBHOOK_URL` (see `.env.example`) — this environment
runs against Sandbox, Plaid's free tier with fake test institutions and
no business verification required. Moving to Production (real banks,
real user data) is a separate Plaid application/approval step, not a
code change.

**Content-Security-Policy note:** `next.config.mjs`'s CSP allowlists
`cdn.plaid.com` (script + frame) and Plaid's API hosts (connect-src),
per Plaid's own documented CSP requirements
(https://plaid.com/docs/link/web/) — Link is a third-party embedded
widget and won't load without these.

## AI narration layer (Phase J)

Real, calling the actual Anthropic API — not mocked. `src/server/services/narration.ts`
is the one place this happens; `src/lib/ai/anthropic.ts` is the thin,
graceful-degradation seam around the API call itself (same pattern as
`src/lib/email.ts`).

**What it does and doesn't do.** The deterministic engines
(`insights.ts`, `forecast.ts`) remain the only source of truth for every
number and conclusion in the app — nothing about them changed for this
phase. Narration takes their already-computed output (an `Insight`'s
headline/explanation/why, or a forecast's projected range + top drivers)
and asks Claude to reword it into warmer, second-person prose. It is
never asked to analyze anything itself, and it never can add a new
number or claim: **every response is independently checked after the
fact** (`assertNoForeignNumbers`) — every digit sequence in the model's
output must already appear in what it was given, or the whole response
is discarded. Combined with a strict system prompt and `temperature: 0`,
this is defense in depth, not just a polite instruction.

**Graceful degradation, same as email/storage/Plaid.** Without
`ANTHROPIC_API_KEY` set, every insight and the forecast page show their
original plain deterministic text — which is already fully correct and
readable on its own; narration is additive polish, never a dependency.
The same fallback fires on any API error, malformed JSON, a missing
field, or a failed number-safety check — there is no code path where a
partial or unvalidated result reaches the page.

**Caching.** One row per `(business, subject)` in the `Narration` table,
keyed additionally by a hash of the exact facts narrated
(`factsHash`) and a 24-hour freshness window. A normal page load is a
cache hit (no LLM call); a changed underlying fact (new invoice, new
expense) or a new day both force regeneration. Only successful,
validated output is ever cached — a fallback is cheap to recompute live,
and caching it would risk showing stale plain text for a day after a key
is added or a transient API error clears up.

**Model:** `claude-haiku-4-5-20251001` by default (override with
`ANTHROPIC_MODEL`) — this task is constrained rewriting of already-correct
text, not open-ended reasoning, so a small/fast/cheap model is the right
fit. Get a key at https://console.anthropic.com (separate from a claude.ai
subscription; pay-per-use, not free) — a few dollars of credit covers
extensive use given how cheap and well-cached these calls are.

**Testing:** `tests/narration.test.ts` covers the number-safety validator
directly (pure logic, no I/O), the caching/regeneration logic with an
injected fake LLM response (deterministic, no network — lets us test
"invents a number → rejected", "cache hit → LLM not called again",
"facts changed → regenerates", etc. without flaking on a real API), *and*
a `describeIfConfigured` block (same convention as
`bank-connections.test.ts`'s real Plaid Sandbox tests) that makes two
real, live calls to the Anthropic API when `ANTHROPIC_API_KEY` is set —
skipped with an honest message, never a false pass, otherwise. Manually
verified end-to-end in a live browser against real seeded demo data: both
the Overview page's five insights and the Forecast page's summary
rendered genuine, distinct, warm prose with every number matching the
underlying facts exactly, and a second page load served the cached
version without a new API call (confirmed via server logs).

**Real bug found and fixed during this phase:** the Anthropic client
wrapper originally cached "is a key configured?" permanently at module
scope after the first call, so a key added (or a test stubbing the env
var) after that first check was silently ignored for the life of the
process. Fixed by keying the cached client on the actual API key value,
not just whether one had ever been seen — this is what let this phase's
own tests catch it (fallback tests ran before the real-API tests in the
same process and would otherwise have poisoned them).

**Also fixed during this phase (infra, not app code):** the earlier
`enable_rls` migration's `_prisma_migrations` RLS statement was silently
breaking `prisma migrate dev`'s shadow-database validation for every
migration created since — see the note added directly in
`prisma/migrations/20260912201500_enable_rls/migration.sql` for the full
root-cause writeup. This phase's own `ai_narration_cache` migration was
authored by hand and applied with `prisma migrate deploy` (which doesn't
need a shadow database) to work around it while developing, and the fix
was verified by reproducing the shadow-db failure with/without that one
line.

## Deployment (Phase C)

Live at **https://fable-tan-three.vercel.app** (Vercel, no custom domain
yet — see below for why that's fine). Deployed via the Vercel CLI against
a personal access token rather than the interactive dashboard flow, and
connected to `github.com/4rus/Fable` for future git-triggered deploys.

**Database isolation.** Production reads/writes its own dedicated
`production` schema in the same Supabase project dev/test/e2e already
share — not the `public` schema local dev and demo data live in. Built
the same way `test`/`e2e` are (see "Testing" above): a schema-scoped
`DATABASE_URL`/`DIRECT_URL` (same connection string, `?schema=production`
appended), migrated with `prisma migrate deploy`. Production also has its
own `NEXTAUTH_SECRET`/`ENCRYPTION_KEY`, generated fresh rather than
reusing dev's — a compromise of one environment's signing/encryption
material never exposes the other's.

**Real bugs found deploying this for the first time, not just
config-following:**
1. Vercel caches `node_modules` between builds and skips Prisma's
   client-generation step unless told to run it explicitly — the first
   deploy failed with `PrismaClientInitializationError` until
   `"postinstall": "prisma generate"` was added to `package.json`.
2. The `enable_rls` migration (and the narration-cache one after it)
   hardcoded `"public".` in every `ALTER TABLE ... ENABLE ROW LEVEL
   SECURITY` statement, unlike every other statement in those files
   (which are correctly unqualified, relying on Prisma setting the
   connection's `search_path` to whatever schema the URL specifies).
   Deploying to the new `production` schema "succeeded" but had silently
   re-enabled RLS on the `public` tables again (harmless — already
   enabled) instead of the new `production` ones. Caught by directly
   querying `pg_tables.rowsecurity` after the deploy rather than trusting
   the migration's exit code; fixed both migration files and enabled RLS
   on all 18 `production`-schema tables by hand, then re-verified true
   for each one.

**Error tracking (Sentry).** Real, not scaffolding — `sentry.server.config.ts`
/ `sentry.edge.config.ts` / `instrumentation.ts` / `instrumentation-client.ts`,
same graceful-degradation pattern as every other integration (a missing
`SENTRY_DSN` is a documented SDK no-op). `src/lib/logger.ts`'s `logError`
— already the one seam every error in this app was written to go
through — now also calls `Sentry.captureException`, so every existing
call site gets real error tracking with no per-call-site change.
`src/app/global-error.tsx` covers the one class of error `logError` can't
reach: a React render crash in the root layout. The client SDK tunnels
through this app's own `/monitoring` path instead of posting to Sentry's
ingest host directly, so the existing CSP needed no third-party
`connect-src` addition. Verified for real: triggered an actual uncaught
exception in a live browser session against the deployed URL and
confirmed a real `POST /monitoring` returned 200, tagged with the correct
org/project IDs. **Known gap:** source map upload to Sentry is disabled
(needs a Sentry auth token + org/project slug not yet configured), so
stack traces there show minified code today — a config-only fix later,
not a re-architecture.

**CI (GitHub Actions, `.github/workflows/ci.yml`).** Runs typecheck,
lint, the full Vitest suite, Playwright E2E, and a production build on
every push to `main` and every PR — against the same real Postgres
`test`/`e2e` schemas local dev uses, not mocks. Needs repo secrets added
(Settings → Secrets and variables → Actions) before it goes green:
`DATABASE_URL`, `DIRECT_URL`, `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM`, `ANTHROPIC_API_KEY` (same values as local `.env`) — not
added automatically since they're real credentials.

**Still real gaps, not silently dropped:**
- No custom domain — genuinely optional. Vercel's free subdomain above
  is a real, HTTPS-secured public URL; a custom domain is a pure DNS/
  branding addition that can be bolted on at any point without touching
  any of the infrastructure work described here.
- Sentry source maps (see above).
- Plaid is still Sandbox-only — real bank data needs Plaid's separate
  Production application/approval, unrelated to hosting.
- **Fixed in Phase Q:** rate limiting was documented here as "fine on
  Vercel's current single-instance behavior" — that was never quite
  true (Vercel runs multiple isolated function instances, each with its
  own memory, so an in-memory counter's effective limit multiplies by
  however many instances handle a burst of traffic). Now backed by real
  Upstash Redis, shared correctly across every instance — see "Security
  model" → "Rate limiting" above.
- File uploads (`src/server/services/attachments.ts`) already support
  real object storage in production — `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` are set there too, same as dev, so new
  uploads land in real Supabase Storage automatically (see "Security
  model" → "File uploads" above); no further work needed here.
