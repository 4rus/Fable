/** Shared constants with no server-action/server-only restrictions on them
 * — a "use server" file may only export async functions, so anything else
 * shared between an action and a service (like a cookie name both need to
 * agree on) lives here instead. */
export const ACTIVE_BUSINESS_COOKIE = "activeBusinessId";
