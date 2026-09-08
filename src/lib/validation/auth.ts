import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  // Length only here; we don't impose fake "complexity" rules that push
  // users toward predictable patterns. bcrypt cost factor does the real work.
  password: z.string().min(10).max(200),
  businessName: z.string().trim().min(1).max(200),
});
