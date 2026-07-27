import type { ActiveTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface ProgressViewProps {
  ticket: ActiveTicket;
  onCancel: () => void;
}

type StepState = "complete" | "active" | "pending" | "error";

function printSteps(ticket: ActiveTicket): Array<{ label: string; state: StepState; detail: string }> {
  const printStatus = ticket.job.status;
  const printed = ["printed", "printed_simulated"].includes(printStatus);
  const renderDone = printStatus !== "rendering" && printStatus !== "failed";
  const agentReached = ["printing", "printed", "printed_simulated"].includes(printStatus);
  const agentActive = ["queued", "claimed", "checking_printer"].includes(printStatus);
  const notionState: StepState = ticket.notion.status === "ready"
    ? "complete"
    : ticket.notion.status === "failed"
      ? "error"
      : "active";
  return [
    ...(ticket.interpretedByAi ? [{
      label: "Interpretando con Vertex AI",
      state: "complete" as StepState,
      detail: "Hecho",
    }] : []),
    { label: "Solicitud guardada", state: "complete", detail: "Hecho" },
    {
      label: "Sincronizando con Notion",
      state: notionState,
      detail: notionState === "complete" ? "Hecho" : notionState === "error" ? "No disponible" : "En proceso",
    },
    {
      label: "Preparando ticket",
      state: renderDone ? "complete" : printStatus === "rendering" ? "active" : "error",
      detail: renderDone ? "Hecho" : printStatus === "rendering" ? "En proceso" : "Error",
    },
    {
      label: "Contactando con el agente",
      state: agentReached ? "complete" : agentActive ? "active" : "pending",
      detail: agentReached ? "Hecho" : agentActive ? "En proceso" : "Pendiente",
    },
    {
      label: "Imprimiendo",
      state: printed ? "complete" : printStatus === "printing" ? "active" : "pending",
      detail: printed ? "Hecho" : printStatus === "printing" ? "En proceso" : "Pendiente",
    },
    {
      label: "Confirmación de impresión",
      state: printed ? "complete" : printStatus === "failed" ? "error" : "pending",
      detail: printed ? "Hecho" : printStatus === "failed" ? "Error" : "Pendiente",
    },
  ];
}

export function ProgressView({ ticket, onCancel }: ProgressViewProps) {
  const status = ticket.job.status;
  const steps = printSteps(ticket);
  return (
    <main className="flow-screen">
      <div className="flow-card">
        <p className="wordmark flow-wordmark"><UiIcon name="printer" size={22} />PrintDesk</p>
        <header><p className="kicker">ENVIANDO</p><h1>Enviando ticket…</h1><p>Puedes cerrar esta pantalla; el proceso continuará en segundo plano.</p></header>
        <ol className="progress-list">
          {steps.map((step, index) => {
            const completed = step.state === "complete";
            const active = step.state === "active";
            return (
              <li className={step.state} key={step.label}>
                <span className="step-marker">{completed ? <UiIcon name="check" size={15} /> : active ? <span className="spinner" /> : step.state === "error" ? "!" : null}</span>
                <span><strong>{index + 1}. {step.label}</strong><small>{step.detail}</small></span>
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
