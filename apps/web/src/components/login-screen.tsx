interface LoginScreenProps {
  busy: boolean;
  error: string | null;
  ready: boolean;
  onLogin: () => void;
}

export function LoginScreen({ busy, error, ready, onLogin }: LoginScreenProps) {
  return (
    <main className="login-screen">
      <div className="login-content">
        <h1>PrintDesk</h1>
        {ready && (
          <button className="google-button" disabled={busy} onClick={onLogin} type="button">
            <span aria-hidden="true" className="google-mark">G</span>
            {busy ? "Accediendo…" : "Acceder con Google"}
          </button>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
