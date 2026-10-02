"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="stack">
      <label>Email<input name="email" type="email" autoComplete="username" required autoFocus defaultValue={state?.email} key={state?.email} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn primary" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
