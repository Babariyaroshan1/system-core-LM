"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Image from "next/image";

export function LoginForm() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    params.get("error") ? "Invalid username or password." : "",
  );
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", {
        identifier: String(form.get("identifier") ?? ""),
        password: String(form.get("password") ?? ""),
        callbackUrl: "/",
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid username or password.");
        setBusy(false);
        return;
      }
      window.location.assign(result?.url ?? "/");
    } catch {
      setError("Unable to sign in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-art" aria-hidden="true">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
        <div className="login-stamp">
          LM<br />
          <span>EST. 2014</span>
        </div>
        <div className="login-caption">
          <span>just the way you like</span>
          <strong>
            Every shift.
            <br />
            Every person.
          </strong>
        </div>
      </div>
      <section className="login-panel">
        <div className="brand-lockup login-brand">
          <Image
            className="brand-logo login-brand-logo"
            src="/LM-logo.png"
            alt="LA MILANO Pizzeria logo"
            width={768}
            height={785}
          />
          <div>
            <strong>LA MILANO</strong>
            <span>ATTENDANCE MANAGEMENT SYSTEM by Roshan</span>
          </div>
        </div>
        <div className="login-copy">
          <div className="eyebrow">TEAM OPERATIONS</div>
          <h1>
            Welcome
            <br />
            back.
          </h1>
          <p>Sign in with your administrator username and password.</p>
          {error && (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={16} />
              {error}
            </div>
          )}
          <form className="login-form" onSubmit={submit}>
            <label className="field">
              <span>Username or email</span>
              <input
                name="identifier"
                type="text"
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Password</span>
              <span className="password-input">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <button className="button button-primary login-submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}
              Sign in
            </button>
          </form>
          <p className="login-footnote">
            Access is managed by your La Milano administrator.
          </p>
        </div>
        <footer>
          LA MILANO <span>ATTENDANCE MANAGEMENT SYSTEM by Roshan</span>
        </footer>
      </section>
    </main>
  );
}