import type { ActiveTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface ProgressViewProps {
  ticket: ActiveTicket;
  onCancel: () => void;
}

const steps = [
  ["Solicitud guardada", ["rendering", "queued", "claimed", "checking_printer", "printing", "printed", "printed_simulated"]],
  ["Preparando ticket", ["queued", "claimed", "checking_printer", "printing", "printed", "printed_simulated"]],
  ["Enviado a la cola", ["queued", "claimed", "checking_printer", "printing", "printed", "printed_simulated"]],
  ["Contactando con el agente", ["claimed", "checking_printer", "printing", "printed", "printed_simulated"]],
  ["Comprobando impresora", ["checking_printer", "printing", "printed", "printed_simulated"]],
  ["Imprimiendo", ["printing", "printed", "printed_simulated"]],
] as const;

export function ProgressView({ ticket, onCancel }: ProgressViewProps) {
  const status = ticket.job.status;
  return (
    <main className="flow-screen">
      <div className="flow-card">
        <p className="wordmark flow-wordmark"><UiIcon name="printer" size={22} />PrintDesk</p>
        <header><p className="kicker">ENVIANDO</p><h1>Enviando ticket…</h1><p>Puedes cerrar esta pantalla; el proceso continuará en segundo plano.</p></header>
        <ol className="progress-list">
          {steps.map(([label, completedStatuses], index) => {
            const completed = completedStatuses.includes(status as never);
            const previousComplete = index === 0 || (steps[index - 1]?.[1].includes(status as never) ?? false);
            const active = !completed && previousComplete;
            return (
              <li className={completed ? "complete" : active ? "active" : ""} key={label}>
                <span className="step-marker">{completed ? <UiIcon name="check" size={15} /> : active ? <span className="spinner" /> : null}</span>
                <span><strong>{index + 1}. {label}</strong><small>{completed ? "Hecho" : active ? "En proceso" : "Pendiente"}</small></span>
              </li>
            );
          })}
        </ol>
        <div className="job-details">
          <span><small>ID DEL TRABAJO</small><strong>{ticket.job.jobId.slice(0, 12)}</strong></span>
          <span><small>TIPO</small><strong>{ticket.draft.type.toUpperCase()}</strong></span>
          <span><small>TÍTULO</small><strong>{ticket.draft.title}</strong></span>
        </div>
        {status === "failed" && <p className="form-error" role="alert">No se pudo completar: {ticket.job.error ?? "error desconocido"}.</p>}
        <button className="secondary-button" onClick={onCancel} type="button">{status === "failed" ? "Volver" : "Ocultar seguimiento"}</button>
      </div>
    </main>
  );
}
