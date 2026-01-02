"use client";

import { useState } from "react";
import { supabase } from "@/src/lib/supabase";
import type { Session } from "@supabase/supabase-js";

export default function AuthGate(props: { onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doSignIn() {
    setErr(null);
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) props.onAuthed(data.session);
  }

  async function doSignUp() {
    setErr(null);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) props.onAuthed(data.session);
    else setErr("Sign-up succeeded. Please confirm your email (if required), then sign in.");
  }

  return (
    <div className="authWrap">
      <div className="card authCard">
        <div className="h1">Home Inventory</div>
        <div className="muted">Sign in to manage your household layout & items.</div>

        <div className="tabs">
          <button className={`tab ${mode === "signin" ? "on" : ""}`} onClick={() => setMode("signin")}>
            Sign in
          </button>
          <button className={`tab ${mode === "signup" ? "on" : ""}`} onClick={() => setMode("signup")}>
            Sign up
          </button>
        </div>

        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />

        {err && <div className="alert">{err}</div>}

        <button
          className="btn primary"
          disabled={busy || !email.trim() || !pw.trim()}
          onClick={mode === "signin" ? doSignIn : doSignUp}
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="muted small">
          If email confirmation is enabled, confirm first then sign in.
        </div>
      </div>
    </div>
  );
}
