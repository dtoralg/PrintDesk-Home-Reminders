import type { PrinterCheckView, PrinterHealthView } from "@printdesk/shared-models";
import { UiIcon } from "./ui-icon";

interface PrinterViewProps {
  check: PrinterCheckView | null;
  checking: boolean;
  error: string | null;
  health: PrinterHealthView | null;
  onCheck: () => void;
}

function formatCheckTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PrinterView({ check, checking, error, health, onCheck }: PrinterViewProps) {
  const checkInProgress = checking || check?.status === "pending" || check?.status === "checking";
  const available = check?.status === "available" || (!checkInProgress && health?.printerStatus === "available");
  const unavailable = check?.status === "unavailable" || (!checkInProgress && health?.printerStatus === "unavailable");
  const resultTitle = checkInProgress
    ? "Comprobando…"
    : available
      ? "Disponible"
      : unavailable
        ? "No disponible"
        : "Sin comprobar";
  const agentLabel = health?.agentStatus === "online"
    ? "Conectado"
    : health?.agentStatus === "offline"
      ? "Desconectado"
      : health?.agentStatus === "checking"
        ? "Contactando"
        : "Sin comprobar";
  const printerLabel = health?.printerStatus === "available"
    ? "Disponible"
    : health?.printerStatus === "unavailable"
      ? "No disponible"
      : health?.printerStatus === "checking"
        ? "Comprobando"
        : "Sin comprobar";

  return (
    <section className="view narrow-view printer-view">
      <header className="view-header"><p className="kicker">IMPRESORA</p><h1>Impresora Casa</h1><p>Comprueba el estado real de la impresora bajo demanda.</p></header>
      <div className="printer-hero">
        <div className="printer-symbol"><UiIcon name="printer" size={46} /></div>
        <strong>{checking ? "Contactando con el agente…" : "Impresora Casa"}</strong>
        <small>{checking ? "El agente está probando la conexión TCP 9100." : "La comprobación no envía papel ni imprime contenido."}</small>
        <button className="primary-button printer-check-button" disabled={checking} onClick={onCheck} type="button">
          {checking ? <><span className="spinner inverse-spinner" />Comprobando</> : "Comprobar ahora"}
        </button>
      </div>

      <div className={`printer-check-result ${available ? "available" : unavailable || error ? "unavailable" : ""}`}>
        <span className="step-marker">
          {checkInProgress ? <span className="spinner" /> : available ? <UiIcon name="check" size={16} /> : unavailable || error ? "!" : null}
        </span>
        <span>
          <small>ÚLTIMA COMPROBACIÓN</small>
          <strong>{resultTitle}</strong>
          <em>{check ? formatCheckTime(check.updatedAt) : "Todavía no se ha solicitado ninguna"}</em>
        </span>
      </div>

      <div className="printer-health-grid">
        <article>
          <span className={`status-dot ${health?.agentStatus === "online" ? "online" : health?.agentStatus === "offline" ? "offline" : "checking"}`} />
          <span><small>AGENTE PC</small><strong>{agentLabel}</strong></span>
        </article>
        <article>
          <span className={`status-dot ${health?.printerStatus === "available" ? "online" : health?.printerStatus === "unavailable" ? "offline" : "checking"}`} />
          <span><small>IMPRESORA</small><strong>{printerLabel}</strong></span>
        </article>
      </div>

      {(error || check?.error) && <p className="form-error" role="alert">{error ?? `No se pudo conectar: ${check?.error}`}</p>}
      <p className="info-note">Esta comprobación requiere que el PC esté encendido y que el agente PrintDesk se haya conectado a Pub/Sub.</p>
    </section>
  );
}
