"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "./actions";

type Props = {
  mode: "login" | "register";
  action: (prev: FormState, form: FormData) => Promise<FormState>;
};

export default function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isLogin = mode === "login";

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={formAction} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">{isLogin ? "Sign in" : "Create account"}</h1>
          <p className="muted text-sm">Warehouse dashboard</p>
        </div>
        {!isLogin && (
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input className="input" id="name" name="name" required autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            minLength={isLogin ? undefined : 8}
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
        </div>
        {state?.error && <p className="error">{state.error}</p>}
        <button className="btn w-full justify-center" disabled={pending}>
          {pending ? "Please wait…" : isLogin ? "Sign in" : "Register"}
        </button>
        <p className="muted text-sm text-center">
          {isLogin ? "No account? " : "Have an account? "}
          <Link className="link" href={isLogin ? "/register" : "/login"}>
            {isLogin ? "Register" : "Sign in"}
          </Link>
        </p>
      </form>
    </main>
  );
}
