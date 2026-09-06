import { useState } from "react";
import { api } from "../api";

export function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!passcode) return;
    setBusy(true);
    try {
      await api.unlock(passcode);
      onUnlock();
    } catch (e) {
      setError((e as Error).message);
      setPasscode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock">
      <div>
        <h1>Boss OS</h1>
        <p>Private</p>
      </div>
      <input
        type="password"
        inputMode="text"
        autoFocus
        value={passcode}
        placeholder="passcode"
        onChange={(e) => { setPasscode(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn" onClick={submit} disabled={busy || !passcode}>
        {busy ? "Checking…" : "Unlock"}
      </button>
      {error && <div style={{ color: "var(--reject)", fontSize: 14 }}>{error}</div>}
    </div>
  );
}
