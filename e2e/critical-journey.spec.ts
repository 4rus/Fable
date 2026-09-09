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

  await test.step("log in and see an empty-state dashboard", async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The login page does a client-side signIn() call, then a router push
    // on success — wait for the actual navigation rather than the default
    // (short) assertion poll, so a slow first-compile of /app doesn't read
    // as a login failure.
    await page.waitForURL(/\/app$/, { timeout: 15_000 });
    // The business name legitimately appears twice (sidebar switcher +
    // dashboard dateline) — assert on the dateline specifically.
    await expect(page.getByText(`${businessName} ·`)).toBeVisible();
    // A brand-new business has no data yet — the dashboard should say so
    // plainly, not show a stale or fabricated number.
    await expect(page.getByText("You're in a good position.")).toBeVisible();
    await expect(page.getByText("$0").first()).toBeVisible();
  });

  await test.step("add a customer", async () => {
    await page.goto("/app/customers");
    await page.getByLabel("Name").fill(customerName);
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByText(customerName)).toBeVisible();
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
    // Invoice ids are cuids (25 chars); require a real one.
    await page.waitForURL(/\/app\/invoices\/(?!new$)[a-z0-9]{20,}$/, { timeout: 15_000 });
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

  await test.step("the dashboard reflects the real cash position after the payment", async () => {
    await page.goto("/app");
    // $200 was collected and nothing spent — cash on hand should be $200,
    // not a fabricated or stale number.
    await expect(page.getByText("$200").first()).toBeVisible();
  });
});
