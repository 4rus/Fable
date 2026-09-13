import { test, expect } from "@playwright/test";

/**
 * The critical user journey, end to end, against a real running server and
 * a real (throwaway) database — no mocking. This is deliberately the one
 * test that proves the whole stack actually works together: auth, tenant
 * isolation setup (signup creates the business + membership), the money
 * math in a real invoice, a real payment, and the insight engine picking
 * it up on the dashboard.
 *
 * This is ONE test with test.step() checkpoints, not several separate
 * test() blocks — Playwright gives every test() its own fresh browser
 * context (and therefore fresh cookies) by default, even inside
 * describe.serial, so splitting a session-dependent flow across multiple
 * test()s silently logs the "next" one out. One continuous story, one
 * shared `page`, one session.
 */
test("signup → invoice → payment → insight", async ({ page }) => {
  const runId = Date.now();
  const email = `e2e-${runId}@example.com`;
  const password = "e2e-test-password-123";
  const businessName = `E2E Test Co ${runId}`;
  const customerName = `E2E Test Customer ${runId}`;
  // A business's "current cash" only counts activity strictly after its
  // startingCashAsOf cutoff, which is set to the moment of signup (see
  // getCurrentCashCents) — a hardcoded past date here would silently fall
  // before that cutoff and never count, which looks exactly like a real
  // bug (cash inexplicably not updating) without being one. Match today.
  const today = new Date().toISOString().slice(0, 10);

  await test.step("sign up", async () => {
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Business name").fill(businessName);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Account created")).toBeVisible();
  });

  await test.step("log in, land on the guided setup screen (Phase N), skip it", async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The login page does a client-side signIn() call, then a router push
    // to /app — but a brand-new business has zero data, so /app itself
    // redirects server-side to the one-time guided setup screen
    // (/app/setup, Phase N) rather than rendering the real dashboard.
    // Wait for the actual navigation rather than the default (short)
    // assertion poll, so a slow first-compile doesn't read as a login
    // failure — /app/setup pulls in getActiveBusinessContext +
    // getOnboardingStatus on top of Next dev's own on-demand compile of
    // every module the route touches for the first time in this fresh
    // server process. 30s matches the headroom this suite already gives
    // slower steps elsewhere (see playwright.config.ts's expect.timeout)
    // without hiding an actual hang, which the overall 120s test timeout
    // still catches.
    await page.waitForURL(/\/app\/setup$/, { timeout: 30_000 });
    await expect(page.getByText("Let's get Fable working for you.")).toBeVisible();
    // This journey exercises manual entry (customer/invoice/payment), not
    // the bank-connection path — skip the guided screen the same way a
    // real user choosing manual entry would.
    await page.getByRole("button", { name: "I'll do this manually" }).click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
  });

  await test.step("see an empty-state dashboard with the onboarding checklist", async () => {
    // The business name legitimately appears twice (sidebar switcher +
    // dashboard dateline) — assert on the dateline specifically.
    await expect(page.getByText(`${businessName} ·`)).toBeVisible();
    // A brand-new business has no data yet — the dashboard should say so
    // plainly, not show a stale or fabricated number.
    await expect(page.getByText("You're in a good position.")).toBeVisible();
    await expect(page.getByText("$0").first()).toBeVisible();
    // Having just skipped the guided setup, the persistent checklist
    // (Phase N) should fill the "things to do" slot instead of a bare
    // "nothing needs attention" — proves the two onboarding surfaces are
    // actually wired together, not just independently reachable.
    await expect(page.getByText("A few things left to set up")).toBeVisible();
    await expect(page.getByText("Add your first customer and invoice")).toBeVisible();
  });

  await test.step("add a customer", async () => {
    await page.goto("/app/customers");
    await page.getByLabel("Name").fill(customerName);
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByText(customerName)).toBeVisible();
  });

  await test.step("log an expense and attach a receipt", async () => {
    await page.goto("/app/expenses");
    await page.getByLabel("Vendor").fill("E2E Test Supplier");
    await page.getByLabel("Amount ($)").fill("42.50");
    await page.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByText("E2E Test Supplier")).toBeVisible();

    // Real PNG magic bytes — the upload path sniffs actual file content,
    // not the claimed filename/mimeType, so this has to be genuine.
    await page.locator('input[type="file"]').setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    });

    const receiptLink = page.getByRole("link", { name: "receipt.png" });
    await expect(receiptLink).toBeVisible({ timeout: 10_000 });

    // Confirm the download route actually serves it (authorized fetch,
    // not just that a link with the right text rendered).
    const href = await receiptLink.getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  });

  let invoiceUrl = "";

  await test.step("create an invoice with the total computed automatically", async () => {
    await page.goto("/app/invoices/new");
    await page.getByLabel("Customer").selectOption({ label: customerName });

    const lineRow = page.locator("form div.flex.gap-2").first();
    await lineRow.getByPlaceholder("Description").fill("Consulting");
    await lineRow.getByLabel("Line 1 quantity").fill("2");
    await lineRow.getByPlaceholder("Unit price").fill("100"); // $100/unit

    // The computed subtotal should reflect 2 * $100 = $200 without the
    // user ever typing a total anywhere — proves the client preview and
    // (checked next) the server-side recomputation agree.
    await expect(page.getByText("Subtotal: $200.00")).toBeVisible();

    await page.getByRole("button", { name: "Create invoice" }).click();
    // NOT /\/app\/invoices\/[a-z0-9]+$/ — "new" is itself all-lowercase and
    // matches that pattern, so waitForURL would resolve immediately against
    // the still-unsubmitted form instead of waiting for the real redirect.
    // Invoice ids are cuids (25 chars); require a real one. 30s for the
    // same reason as the /app wait above — this is /app/invoices/[id]'s
    // own first cold compile in this fresh server process.
    await page.waitForURL(/\/app\/invoices\/(?!new$)[a-z0-9]{20,}$/, { timeout: 30_000 });
    invoiceUrl = page.url();
    await expect(page.getByText("$200.00").first()).toBeVisible();
  });

  await test.step("send the invoice and record a full payment against it", async () => {
    await page.goto(invoiceUrl);
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("Sent")).toBeVisible();

    // The amount field defaults to the full balance due — submit as-is to
    // pay it off completely.
    await page.getByRole("button", { name: "Record payment" }).click();

    await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("$0.00").first()).toBeVisible();
  });

  await test.step("import expenses from a CSV, skipping the deposit row without guessing an invoice match", async () => {
    await page.goto("/app/expenses/import");
    const csv = [
      "Date,Description,Amount",
      `${today},Coffee Shop,-15.00`,
      `${today},Mystery Deposit,300.00`, // must be skipped, never turned into a payment
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({
      name: "statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview import" }).click();

    await expect(page.getByText("Found 1 expense")).toBeVisible();
    await expect(page.getByText("1 deposit skipped")).toBeVisible();
    await expect(page.getByText("Coffee Shop")).toBeVisible();
    // The skipped deposit must never appear as an importable row.
    await expect(page.getByText("Mystery Deposit")).toHaveCount(0);

    await page.getByRole("button", { name: "Import 1 expense" }).click();
    await expect(page.getByText("Imported 1 expense")).toBeVisible();
  });

  await test.step("the dashboard reflects the real cash position after the payment and import", async () => {
    await page.goto("/app");
    // $200 collected, minus the $42.50 manual expense, minus the $15.00
    // imported expense = $142.50 — every one of these numbers traceable
    // back to a real action taken earlier in this test.
    await expect(page.getByText("$142.50").first()).toBeVisible();
  });
});
