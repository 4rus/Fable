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
- **Prisma + SQLite (dev) / Postgres (prod)** — see "Database" below.
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
cp .env.example .env        # fill in NEXTAUTH_SECRET (see comment in the file)
npm run db:migrate          # creates prisma/dev.db and applies migrations
npm run db:seed             # wipes and reseeds a realistic demo business
npm run dev
```

Demo login after seeding: `demo@example.com` / `demo-password-123`.
**Reseeding wipes all data and invalidates any active session** — sign in
again afterward.

### Environment variables

See `.env.example` for the full list with comments. The two that matter:

- `DATABASE_URL` — `file:./dev.db` locally; a real `postgresql://...` URL in
  any shared/production environment. The schema is written to work
  identically on both (see "Database" below).
- `NEXTAUTH_SECRET` — generate with `npx auth secret` or `openssl rand -base64 32`.
  Never commit this. Rotating it invalidates every existing session.

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
                            management. Run against a throwaway SQLite file
                            (tests/test.db), never your dev database.
e2e/
  *.spec.ts                Playwright: full-stack critical user journeys
                            (signup through payment, plus attachment
                            upload/download and CSV import) against a
                            real running server + real database.
uploads/                   Local dev storage for attachment files (see
                           "Deployment" — not production-viable as-is).
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
outstanding token for that user. What's still a placeholder is
*delivery* — no email provider is configured in this environment, so
`/forgot-password` prints the reset link directly on the page (clearly
labeled "Development mode") instead of emailing it. Wiring in a real
mail provider (Resend, Postmark, SES) only changes how the link is
delivered, not the token logic itself.

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
`String` in the schema, not native Prisma enums — SQLite has no enum type,
and we want the dev (SQLite) and prod (Postgres) schemas to stay
identical. The allowed values live in `src/lib/types.ts` and are enforced
by the Zod schemas at every write path — never write one of these columns
with a raw string that didn't come through there.

## Testing

Three layers:

1. **Unit** — pure logic with no I/O: `tests/money.test.ts`,
   `tests/validation.test.ts`.
2. **Integration** — service-layer logic against a real (throwaway)
   database: invoices/payments, forecast determinism, insight generation,
   team management, tenant isolation. This is most of the suite, and it's
   where the financial-correctness and security guarantees are actually
   proven (overpayment rejection, idempotency, cross-tenant access denial,
   the "last owner can't be removed" invariant, etc).
3. **End-to-end** (`e2e/`) — Playwright driving a real browser against a
   real running server and real database, covering the critical user
   journeys: sign up → create a customer → create an invoice → record a
   payment → see it reflected as an insight on the dashboard.

Run `npm test` for (1)+(2), `npm run test:e2e` for (3). CI should run both
before merge; neither currently runs in a CI pipeline because none is
configured yet (there's no `.github/workflows` in this repo) — that's a
real gap, not a hidden assumption.

## Deployment

Not yet deployed anywhere. To take this to a real environment:

1. Provision a Postgres database and set `DATABASE_URL` to it — the schema
   requires no changes (see "Database" above).
2. Set a strong, unique `NEXTAUTH_SECRET` and the real `NEXTAUTH_URL` in
   the hosting environment.
3. Run `npx prisma migrate deploy` (not `migrate dev`) as part of your
   deploy step.
4. Put file uploads (see `src/server/services/attachments.ts`) on real
   object storage (S3-compatible) with private ACLs instead of local
   disk — the current implementation stores locally under `uploads/`,
   which does **not** survive a redeploy on most hosts and does not
   scale past one instance. This is flagged in code as a
   `// TODO(production)` — do not ship this to a multi-instance host
   without fixing it first.
5. Add a real error-tracking/observability tool (Sentry or equivalent) —
   `src/lib/logger.ts` has a single seam (`logError`) where that plugs in;
   right now it only writes structured JSON to stdout.
