import type { ActiveTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface QueuedResultViewProps {
  ticket: ActiveTicket;
  onFinish: () => void;
}

export function QueuedResultView({ ticket, onFinish }: QueuedResultViewProps) {
  return (
    <main className="flow-screen">
      <div className="result-card queued-result-card">
        <p className="wordmark flow-wordmark"><UiIcon name="printer" size={22} />PrintDesk</p>
        <div className="result-icon"><UiIcon name="clock" size={45} /></div>
        <h1>Enviado a la cola</h1>
        <p>Se imprimirá automáticamente cuando el agente de casa esté disponible.</p>

        <div className="queue-status-list">
          <article>
            <UiIcon name="user" size={20} />
            <span><small>AGENTE PC</small><strong>Esperando conexión</strong><em>El agente aún no ha recogido el ticket</em></span>
          </article>
          <article>
            <UiIcon name="printer" size={20} />
            <span><small>IMPRESORA CASA</small><strong>Pendiente de comprobación</strong><em>Se comprobará justo antes de imprimir</em></span>
          </article>
        </div>

        <p className="queue-note">Tu ticket está guardado. Puedes cerrar esta pantalla: no necesitas mantener la PWA abierta.</p>
        <div className="result-actions">
          {ticket.notion.status === "ready" && ticket.notion.url && (
            <a className="secondary-button" href={ticket.shortUrl} rel="noreferrer" target="_blank">Ver en Notion</a>
          )}
          <a className="secondary-button" href={`${ticket.shortUrl}?view=live`} rel="noreferrer" target="_blank">Ver ticket</a>
          <button className="primary-button" onClick={onFinish} type="button">Finalizar</button>
        </div>
      </div>
    </main>
  );
}
