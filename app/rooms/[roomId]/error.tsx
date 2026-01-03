"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 你也可以在这里上报日志
    console.error("Room page error:", error);
  }, [error]);

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
        Room page crashed (client-side exception)
      </h2>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,.15)",
          background: "rgba(220,0,0,.06)",
          whiteSpace: "pre-wrap",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Message</div>
        {String(error?.message ?? "Unknown error")}
        {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        {error?.stack ? `\n\nstack:\n${error.stack}` : ""}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => reset()}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,.15)",
            background: "white",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Retry
        </button>

        <a
          href="/rooms"
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,.15)",
            background: "white",
            display: "inline-block",
            textDecoration: "none",
            color: "inherit",
            fontWeight: 900,
          }}
        >
          Back to Rooms
        </a>
      </div>

      <div style={{ marginTop: 10, color: "rgba(0,0,0,.65)", fontSize: 13 }}>
        Open DevTools Console for the full stack trace and paste it back here.
      </div>
    </div>
  );
}
