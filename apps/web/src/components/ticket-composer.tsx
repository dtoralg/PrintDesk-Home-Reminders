"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import type { CreateRequestResult, PrintJobView, RequestType } from "@printdesk/shared-models";
import { firebaseAuth, firebaseConfigured, googleProvider } from "@/lib/firebase";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const types: Array<[RequestType, string, string]> = [
  ["task", "✓", "Tarea"],
  ["idea", "✦", "Idea"],
  ["reminder", "◷", "Recordatorio"],
  ["note", "▤", "Nota"],
];

export function TicketComposer() {
  const [type, setType] = useState<RequestType>("task");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [job, setJob] = useState<PrintJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    return onAuthStateChanged(firebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!job || ["printed", "printed_simulated", "failed"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/print-jobs/${job.jobId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (response.ok) setJob((await response.json()) as PrintJobView);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, user]);

  useEffect(() => {
    const remotePreview = job?.previewUrl;
    setPreviewUrl(null);
    if (!remotePreview) {
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(remotePreview, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setPreviewUrl(objectUrl);
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [job?.previewUrl, user]);

  async function logIn() {
    setError(null);
    try {
      await signInWithPopup(firebaseAuth(), googleProvider());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (firebaseConfigured && !user) throw new Error("Inicia sesión antes de preparar un ticket.");
      idempotencyKey.current ??= crypto.randomUUID();
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ request: { type, title, body, important, dueAt: null }, printerId: "home", source: "pwa" }),
      });
      if (!response.ok) throw new Error(`No se pudo preparar el ticket (${response.status}).`);
      setJob(((await response.json()) as CreateRequestResult).job);
      idempotencyKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="auth-strip" aria-live="polite">
        {!authReady ? (
          <span>COMPROBANDO IDENTIDAD…</span>
        ) : user ? (
          <><span>{user.email}</span><button onClick={() => void signOut(firebaseAuth())} type="button">Cerrar sesión</button></>
        ) : firebaseConfigured ? (
          <><span>ACCESO RESTRINGIDO</span><button onClick={() => void logIn()} type="button">Entrar con Google</button></>
        ) : (
          <span>MODO LOCAL / SIN FIREBASE</span>
        )}
      </section>
      <section className="composer-grid">
      <form className="composer-card" onSubmit={submit}>
        <label className="field-label" htmlFor="title"><span>01</span>TÍTULO</label>
        <input id="title" maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Llamar a Sanitas" required value={title} />
        <label className="field-label" htmlFor="body"><span>02</span>DETALLE</label>
        <textarea id="body" maxLength={2000} onChange={(event) => setBody(event.target.value)} placeholder="Preguntar por la analítica…" rows={4} value={body} />
        <fieldset>
          <legend><span>03</span> TIPO</legend>
          <div className="type-picker">
            {types.map(([value, icon, label]) => (
              <button className={type === value ? "selected" : ""} key={value} onClick={() => setType(value)} type="button">
                <span aria-hidden="true">{icon}</span>{label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="check"><input checked={important} onChange={(event) => setImportant(event.target.checked)} type="checkbox" /> Marcar como importante</label>
        <button className="primary-action" disabled={busy || !title.trim() || !authReady || (firebaseConfigured && !user)} type="submit">
          {busy ? "Preparando…" : "Guardar y preparar"}<span aria-hidden="true">→</span>
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        {job && <p className="job-state" aria-live="polite">ESTADO / {job.status.replaceAll("_", " ").toUpperCase()}</p>}
      </form>

      <aside className="preview-panel" aria-label="Vista previa">
        <div className="preview-heading"><span>VISTA PREVIA</span><span>80 MM / 1-BIT</span></div>
        {previewUrl ? (
          // El renderer fija las dimensiones; se evita next/image porque la URL pertenece al API local.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rendered-ticket" src={previewUrl} alt={`Ticket ${title}`} />
        ) : (
          <article className="paper-ticket">
            <div className="ticket-kind">{type.toUpperCase()}</div>
            <p className="ticket-star">{important ? "★" : "☆"}</p>
            <h2>{title.trim() || "TU PRÓXIMO TICKET"}</h2>
            <div className="ticket-rule" />
            <p>{body || "La vista renderizada aparecerá después de validar la solicitud."}</p>
            <small>ABRIR NOTA VIVA</small>
          </article>
        )}
      </aside>
      </section>
    </>
  );
}
