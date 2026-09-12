# Fable

Financial visibility software for small business owners who aren't accountants.
Instead of a ledger, Fable tells you what changed in your business, why, and
what to do about it — grounded entirely in your own transactions.

## Product thesis (why this exists)

See the Product Thesis discussed in project history: the differentiator is
**interpretation, not automation**. Every insight the app shows is
deterministic arithmetic over real rows in your database (see
`src/server/services/insights.ts` and `forecast.ts`) — never an LLM guess.
If an AI layer is added later, its only job is turning that structured,
already-correct data into friendlier prose. It must never be allowed to
invent a number or a conclusion of its own.

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
(`src/lib/rate-limit.ts`) — see the comment there for the current
in-memory implementation's limits (single-instance only; swap for a
Redis-backed limiter before running more than one server process).

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

## Deployment

Not yet deployed to a public URL. What IS real: the database is a real
Supabase Postgres project (via its Supavisor pooler — see "Environment
variables" above), and dev/seed/tests/E2E already run against it. What's
still needed to actually deploy the app itself:

1. Pick a hosting target for the Next.js app (Vercel is the obvious fit)
   and set `DATABASE_URL` / `DIRECT_URL` / `NEXTAUTH_SECRET` /
   `NEXTAUTH_URL` (and `ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`)
   there — no schema changes needed, this environment's `.env` values
   already point at the real target database.
2. Run `npx prisma migrate deploy` (not `migrate dev`) as part of your
   deploy step.
3. **Done, needs credentials:** file uploads
   (`src/server/services/attachments.ts`) go through a provider-agnostic
   storage layer (`src/server/services/storage/`) with two real backends
   — local disk (`localDisk.ts`, the dev default, same isolation risk as
   before: doesn't survive a redeploy or scale past one instance) and
   Supabase Storage (`supabaseStorage.ts`, a private bucket, created
   automatically on first upload). Set `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to switch new uploads to the real backend
   — no other code change needed. Each `Attachment` row records which
   backend it actually landed on (`provider` column), so flipping this on
   never breaks reading/deleting files uploaded before it was set.
4. Add a real error-tracking/observability tool (Sentry or equivalent) —
   `src/lib/logger.ts` has a single seam (`logError`) where that plugs in;
   right now it only writes structured JSON to stdout.
