import type { User } from "firebase/auth";
import type { PaperRollView, PrinterHealthView } from "@printdesk/shared-models";
import type { CreationMode, RecentTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";
import { SimpleTicketComposer } from "./simple-ticket-composer";

interface HomeViewProps {
  recentTickets: RecentTicket[];
  user: User | null;
  onCompose: () => void;
  onHistory: () => void;
  onPrinter: () => void;
  onAiPrint: (text: string) => void;
  onAiReview: (text: string) => void;
  onModeChange: (mode: CreationMode) => void;
  health: PrinterHealthView | null;
  paperRoll: PaperRollView | null;
  mode: CreationMode;
  aiBusy: boolean;
  aiError: string | null;
}

const statusLabel: Record<RecentTicket["status"], string> = {
  rendering: "PREPARANDO",
  queued: "EN COLA",
  claimed: "EN PROCESO",
  checking_printer: "COMPROBANDO",
  printing: "IMPRIMIENDO",
  printed: "IMPRESO",
  printed_simulated: "SIMULADO",
  failed: "ERROR",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function HomeView({
  recentTickets,
  user,
  onCompose,
  onHistory,
  onPrinter,
  onAiPrint,
  onAiReview,
  onModeChange,
  health,
  paperRoll,
  mode,
  aiBusy,
  aiError,
}: HomeViewProps) {
  const firstName = user?.displayName?.split(" ")[0] ?? "Dani";
  const pending = recentTickets.filter((ticket) => !["printed", "printed_simulated", "failed"].includes(ticket.status)).length;
  const agentStatus = health?.agentStatus === "online"
    ? "Conectado"
    : health?.agentStatus === "offline"
      ? "Desconectado"
      : health?.agentStatus === "checking"
        ? "Contactando…"
        : "Sin comprobar";
  const printerStatus = health?.printerStatus === "available"
    ? "Disponible"
    : health?.printerStatus === "unavailable"
      ? "No disponible"
      : health?.printerStatus === "checking"
        ? "Comprobando…"
        : "TCP · 192.168.1.153";
  const agentDotClass = `status-dot ${health?.agentStatus === "online" ? "online" : health?.agentStatus === "offline" ? "offline" : "checking"}`;
  const printerDotClass = `status-dot ${health?.printerStatus === "available" ? "online" : health?.printerStatus === "unavailable" ? "offline" : "checking"}`;
  return (
    <section className="view home-view">
      <header className="view-header">
        <p className="kicker">INICIO</p>
        <h1>Hola, {firstName}.</h1>
        <p><span className="desktop-only-copy">Aquí tienes el estado general de PrintDesk.</span><span className="mobile-only-copy">Todo listo.</span></p>
      </header>

      <div className="creation-mode-switch" role="group" aria-label="Modo de creación">
        <button aria-pressed={mode === "simple"} className={mode === "simple" ? "active" : ""} onClick={() => onModeChange("simple")} type="button">
          <UiIcon name="sparkles" size={16} />Modo sencillo
        </button>
        <button aria-pressed={mode === "advanced"} className={mode === "advanced" ? "active" : ""} onClick={() => onModeChange("advanced")} type="button">
          <UiIcon name="settings" size={16} />Modo avanzado
        </button>
      </div>

      {mode === "simple" ? (
        <SimpleTicketComposer busy={aiBusy} error={aiError} onAdvanced={onCompose} onPrint={onAiPrint} onReview={onAiReview} />
      ) : (
        <button className="create-ticket-card" onClick={onCompose} type="button">
          <span className="create-icon"><UiIcon name="plus" size={26} /></span>
          <span><strong>Crear ticket manualmente</strong><small>Control completo de todos los campos</small></span>
          <UiIcon name="arrow" size={21} />
        </button>
      )}

      <div className="mobile-quick-status">
        <p className="micro-label">ESTADO RÁPIDO</p>
        <button onClick={onPrinter} type="button">
          <UiIcon name="user" size={18} />
          <span><strong>Agente PC</strong><small>{agentStatus}</small></span>
          <span className={agentDotClass} />
        </button>
        <button onClick={onPrinter} type="button">
          <UiIcon name="printer" size={18} />
          <span><strong>Impresora Casa</strong><small>{printerStatus}</small></span>
          <span className={printerDotClass} />
        </button>
      </div>

      <button className="mobile-pending-card" onClick={onHistory} type="button">
        <span>Pendientes de impresión</span>
        <strong>{pending}</strong>
        <UiIcon name="arrow" size={18} />
      </button>

      <div className="section-heading desktop-summary-heading"><span>RESUMEN</span></div>
      <div className="summary-grid">
        <article><span>Pendientes de impresión</span><strong>{pending}</strong><button onClick={onHistory} type="button">Ver historial →</button></article>
        <article><span>Última impresión</span><strong>{recentTickets[0] ? formatTime(recentTickets[0].updatedAt) : "—"}</strong><small>{recentTickets[0]?.title ?? "Aún no hay tickets"}</small></article>
        <article className="paper-summary">
          <span>Papel restante</span>
          <strong>{paperRoll ? `${paperRoll.remainingMeters.toLocaleString("es-ES", { maximumFractionDigits: 1 })} m` : "Sin configurar"}</strong>
          <small>
            {paperRoll
              ? `${paperRoll.usedMeters.toLocaleString("es-ES", { maximumFractionDigits: 1 })} m usados${paperRoll.estimatedTicketsRemaining === null ? "" : ` · ~${paperRoll.estimatedTicketsRemaining} tickets`}`
              : "Registra el rollo en Ajustes"}
          </small>
          {paperRoll && <span className="paper-meter"><i style={{ width: `${paperRoll.remainingPercent}%` }} /></span>}
        </article>
      </div>

      <div className="section-heading"><span>ÚLTIMOS TICKETS</span></div>
      <div className="recent-list">
        {recentTickets.length ? recentTickets.slice(0, 4).map((ticket) => (
          <a href={ticket.shortUrl} key={ticket.jobId} rel="noreferrer" target="_blank">
            <span className="recent-icon"><UiIcon name={ticket.type} size={17} /></span>
            <span className="recent-copy"><strong>{ticket.title}</strong><small>{formatTime(ticket.updatedAt)}</small></span>
            <span className={`status-badge status-${ticket.status}`}>{statusLabel[ticket.status]}</span>
          </a>
        )) : (
          <div className="empty-state"><UiIcon name="note" size={24} /><p>Tu primer ticket aparecerá aquí.</p></div>
        )}
      </div>
      {recentTickets.length > 4 && <button className="text-link" onClick={onHistory} type="button">Ver todo el historial →</button>}
    </section>
  );
}
