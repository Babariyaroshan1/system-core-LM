export const instant = false;

import { LoginForm } from "@/components/login-form";
import { Suspense } from "react";

export default function LoginPage() { return <Suspense fallback={<main className="login-screen"><section className="login-panel">Loading sign-in…</section></main>}><LoginForm /></Suspense>; }