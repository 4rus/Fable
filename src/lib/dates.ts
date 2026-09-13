/**
 * THE ONLY MODULE THAT SHOULD FORMAT DATES FOR DISPLAY.
 *
 * `date.toLocaleDateString()` with no locale argument resolves to the
 * RUNTIME's default locale (Intl.DefaultLocale) — which can differ
 * between Node's server runtime and a browser, and even between two
 * different servers. Two real problems that causes, found during Phase O:
 *
 *  1. In a server component, the rendered date reflects the SERVER's
 *     locale, not the visitor's — inconsistent and, on some Node builds,
 *     renders as a bare "2026-09-20" instead of anything resembling a
 *     normal date.
 *  2. In a "use client" component, calling it on a Date received as a
 *     prop can produce a genuine hydration mismatch if the server and
 *     browser locales differ (see the Phase K note in memory about this
 *     exact class of bug) — the server-rendered HTML and the client's
 *     first render disagree, and React throws a hydration warning.
 *
 * The fix for both: always pass an EXPLICIT locale. `toLocaleDateString`
 * with an explicit locale + options is fully deterministic — same input,
 * same output, wherever it runs. This is the standard fix for this class
 * of Next.js hydration bug, and it means a "use client" component CAN
 * safely format a Date prop itself again, as long as it goes through
 * this module rather than calling toLocaleDateString directly.
 */

/** "Sep 20, 2026" — the default, used for most dates in the app. */
export function formatDate(date: Date, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return date.toLocaleDateString("en-US", options);
}

/** "Sunday, September 13" — the Overview page's dateline style. */
export function formatDateLong(date: Date): string {
  return formatDate(date, { weekday: "long", month: "long", day: "numeric" });
}

/** "Sep 20" — no year, used where the year is already obvious from context. */
export function formatDateShort(date: Date): string {
  return formatDate(date, { month: "short", day: "numeric" });
}

/** "Sep 20, 2026, 3:45 PM" — for messages that need to tell someone
 * exactly when something will happen/happened, not just which day. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
