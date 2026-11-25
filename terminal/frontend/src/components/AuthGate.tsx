// Shows a token prompt when the server requires an access token.
import { useEffect, useState, type ReactNode } from "react";

type State = "checking" | "ok" | "login";

async function login(token: string) {
  const res = await fetch("/terminal/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const urlToken = new URLSearchParams(location.search).get("token");
        if (urlToken) await login(urlToken);
        const s = await (await fetch("/terminal/session")).json();
        setState(!s.auth_required || s.authenticated ? "ok" : "login");
      } catch {
        setState("ok"); // server unreachable: let the app show its own errors
      }
    };
    check();
    const onAuth = () => setState("login");
    window.addEventListener("odp-auth-required", onAuth);
    return () => window.removeEventListener("odp-auth-required", onAuth);
  }, []);

  if (state === "ok") return <>{children}</>;
  if (state === "checking") return <div className="state">Connecting…</div>;
  return (
    <div className="auth">
      <form
        className="auth-box"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (await login(value)) location.reload();
          else setError("That access token was not accepted.");
        }}
      >
        <div className="brand">
          <span className="brand-mark">ODP</span> TERMINAL
        </div>
        <p className="muted">This server requires an access token. It is printed in the server's console when it starts.</p>
        <input className="input" autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Access token" />
        <button className="btn btn-wide" disabled={!value.trim()}>
          Unlock
        </button>
        {error && <div className="state-error small">{error}</div>}
      </form>
    </div>
  );
}
