import { z } from "zod";

export const checkCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const confirmTwoFactorSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1),
});
