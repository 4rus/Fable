"use server";

import { redirect } from "next/navigation";
import { signupSchema } from "@/lib/validation/auth";
import { signUp, EmailInUseError } from "@/server/services/signup";

export type SignupFormState = { error?: string };

export async function signupAction(
  _prevState: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    businessName: formData.get("businessName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await signUp(parsed.data);
  } catch (err) {
    if (err instanceof EmailInUseError) return { error: err.message };
    console.error("signup failed", err);
    return { error: "Something went wrong creating your account. Please try again." };
  }

  redirect("/login?created=1");
}
