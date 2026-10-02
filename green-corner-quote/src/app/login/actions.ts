"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth";

// Simple in-process throttle: 10 failures per 15 minutes, then locked until the window passes.
const fails: number[] = [];
const WINDOW = 15 * 60_000;

export async function login(_: { error?: string; email?: string } | undefined, form: FormData): Promise<{ error?: string; email?: string }> {
  const now = Date.now();
  while (fails.length && now - fails[0] > WINDOW) fails.shift();
  if (fails.length >= 10) return { error: "Too many attempts. Try again in a few minutes.", email: String(form.get("email") ?? "") };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const hash = process.env.ADMIN_PASSWORD_HASH ?? "";
  if (!adminEmail || !hash) return { error: "Admin account is not configured on the server." };

  // Always run the comparison so timing does not reveal whether the email matched.
  const passwordOk = await bcrypt.compare(password, hash);
  if (email !== adminEmail || !passwordOk) {
    fails.push(now);
    return { error: "Wrong email or password.", email: String(form.get("email") ?? "") };
  }
  await setSessionCookie(adminEmail);
  redirect("/quotes");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
