"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

export default function AuthGate(props: { onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setErr(null);
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) props.onAuthed(data.session);
  }

  async function signUp() {
    setErr(null);
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email, password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) props.onAuthed(data.session);
    else setErr("Sign-up successful. Please check your email to confirm, then sign in.");
  }

  return (
    <div className="authWrap">
      <div className="authCard">
        <div className="authTitle">Inventory</div>
        <div className="authSub">Sign in required</div>

        <div className="authTabs">
          <button className={`authTab ${mode === "signin" ? "on" : ""}`} onClick={() => setMode("signin")}>
            Sign in
          </button>
          <button className={`authTab ${mode === "signup" ? "on" : ""}`} onClick={() => setMode("signup")}>
            Sign up
          </button>
        </div>

        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" type="password" />

        {err && <div className="authErr">{err}</div>}

        <button className="primary" disabled={busy || !email || !pw} onClick={mode === "signin" ? signIn : signUp}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="authHint">If email confirmation is enabled, confirm email then sign in.</div>
      </div>

      <style jsx global>{`
        :root {
          --bg: #fbf7f0;
          --panel: #fffaf2;
          --panel2: #fffdf7;
          --text: #1f2328;
          --muted: #6b6f76;
          --border: #e7ddcf;
          --border2: #efe6d9;
          --blue: #2f5d7c;
          --shadow: 0 10px 24px rgba(31, 35, 40, 0.06);
          --radius: 14px;
        }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        }
        .authWrap {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 16px;
        }
        .authCard {
          width: min(420px, 100%);
          background: var(--panel);
          border: 1px solid var(--border2);
          border-radius: var(--radius);
          padding: 16px;
          box-shadow: var(--shadow);
          display: grid;
          gap: 10px;
        }
        .authTitle {
          font-weight: 900;
          font-size: 18px;
        }
        .authSub {
          font-size: 12px;
          color: var(--muted);
          margin-top: -6px;
        }
        .authTabs {
          display: flex;
          gap: 8px;
        }
        .authTab {
          flex: 1;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--panel2);
          cursor: pointer;
          font-weight: 900;
          font-size: 12px;
        }
        .authTab.on {
          border-color: rgba(47, 93, 124, 0.35);
          background: rgba(47, 93, 124, 0.08);
          color: var(--blue);
        }
        .input {
          padding: 10px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel2);
          width: 100%;
          font-size: 14px;
        }
        .input:focus {
          outline: none;
          border-color: rgba(47, 93, 124, 0.5);
          box-shadow: 0 0 0 4px rgba(47, 93, 124, 0.12);
        }
        .primary {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(47, 93, 124, 0.35);
          background: var(--blue);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
        .primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .authErr {
          font-size: 12px;
          color: rgba(155, 28, 28, 0.95);
          background: #fff1f1;
          border: 1px solid #f0caca;
          padding: 10px;
          border-radius: 12px;
        }
        .authHint {
          font-size: 12px;
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}

