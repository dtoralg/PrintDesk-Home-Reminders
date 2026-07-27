"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { ActiveTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface ResultViewProps {
  ticket: ActiveTicket;
  user: User | null;
  onCreateAnother: () => void;
  onFinish: () => void;
}

export function ResultView({ ticket, user, onCreateAnother, onFinish }: ResultViewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket.job.previewUrl) return;
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(ticket.job.previewUrl!, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) return;
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setPreviewUrl(objectUrl);
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ticket.job.previewUrl, user]);

  return (
    <main className="flow-screen">
      <div className="result-card">
        <p className="wordmark flow-wordmark"><UiIcon name="printer" size={22} />PrintDesk</p>
        <div className="result-icon"><UiIcon name="check" size={48} /></div>
        <h1>¡Impreso correctamente!</h1>
        <p>Tu ticket ha salido de la impresora.</p>
        <article className={previewUrl ? "result-ticket has-preview" : "result-ticket"}>
          {previewUrl ? (
            // La imagen procede del endpoint autenticado de PrintDesk y conserva su tamaño térmico real.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`Vista previa de ${ticket.draft.title}`} src={previewUrl} />
          ) : (
            <>
              <div>
                <span className="result-kind">{ticket.draft.type.toUpperCase()}</span>
                <span>{ticket.draft.important ? "★" : "☆"}</span>
              </div>
              <h2>{ticket.draft.title}</h2>
              <p>{ticket.draft.body || "Sin detalles adicionales."}</p>
            </>
          )}
        </article>
        <div className="result-actions">
          {ticket.notion.status === "ready" && ticket.notion.url && (
            <a className="secondary-button" href={ticket.notion.url}>Abrir en Notion</a>
          )}
          <a className="secondary-button" href={`${ticket.shortUrl}?view=live`} rel="noreferrer" target="_blank">Ver ticket</a>
          <button className="primary-button" onClick={onCreateAnother} type="button"><span>Crear otro ticket</span><UiIcon name="plus" size={18} /></button>
        </div>
        {ticket.notion.status === "failed" && <p className="form-error">El ticket se imprimió, pero no pudo sincronizarse con Notion.</p>}
        <button className="text-link result-finish" onClick={onFinish} type="button">Finalizar</button>
      </div>
    </main>
  );
}
