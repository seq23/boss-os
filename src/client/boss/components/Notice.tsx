import type { ApiError } from "../api";

/**
 * Errors say what happened and what to do about it. They never apologise, and
 * they never swallow the hint the server took the trouble to send.
 */
export function ErrorNotice({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="notice notice-error" role="alert">
      <strong>{e.message ?? "Something failed"}</strong>
      {e.hint && <span className="notice-hint">{e.hint}</span>}
      {onDismiss && (
        <button className="notice-x" onClick={onDismiss} aria-label="Dismiss">×</button>
      )}
    </div>
  );
}

export function InfoNotice({ children, tone = "brass" }: { children: React.ReactNode; tone?: string }) {
  return (
    <div className="notice" style={{ borderColor: `var(--${tone})` }}>
      {children}
    </div>
  );
}
