import type { User } from "firebase/auth";
import type { PrinterCheckView } from "@printdesk/shared-models";
import type { RecentTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface HomeViewProps {
  recentTickets: RecentTicket[];
  user: User | null;
  onCompose: () => void;
  onHistory: () => void;
  onPrinter: () => void;
  printerCheck: PrinterCheckView | null;
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

export function HomeView({ recentTickets, user, onCompose, onHistory, onPrinter, printerCheck }: HomeViewProps) {
  const firstName = user?.displayName?.split(" ")[0] ?? "Dani";
  const pending = recentTickets.filter((ticket) => !["printed", "printed_simulated", "failed"].includes(ticket.status)).length;
  const checkResponded = printerCheck && ["available", "unavailable"].includes(printerCheck.status);
  const agentStatus = checkResponded ? "Conectado" : printerCheck ? "Contactando…" : "Configurado";
  const printerStatus = printerCheck?.status === "available"
    ? "Disponible"
    : printerCheck?.status === "unavailable"
      ? "No disponible"
      : printerCheck
        ? "Comprobando…"
        : "TCP · 192.168.1.153";
  return (
    <section className="view home-view">
      <header className="view-header">
        <p className="kicker">INICIO</p>
        <h1>Hola, {firstName}.</h1>
        <p><span className="desktop-only-copy">Aquí tienes el estado general de PrintDesk.</span><span className="mobile-only-copy">Todo listo.</span></p>
      </header>

      <button className="create-ticket-card" onClick={onCompose} type="button">
        <span className="create-icon"><UiIcon name="plus" size={26} /></span>
        <span><strong>Crear nuevo ticket</strong><small>Modo simple (recomendado)</small></span>
        <UiIcon name="arrow" size={21} />
      </button>

      <div className="mobile-quick-status">
        <p className="micro-label">ESTADO RÁPIDO</p>
        <button onClick={onPrinter} type="button">
          <UiIcon name="user" size={18} />
          <span><strong>Agente PC</strong><small>{agentStatus}</small></span>
          <span className="status-dot" />
        </button>
        <button onClick={onPrinter} type="button">
          <UiIcon name="printer" size={18} />
          <span><strong>Impresora Casa</strong><small>{printerStatus}</small></span>
          <span className={printerCheck?.status === "unavailable" ? "status-dot offline" : "status-dot"} />
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
        <article><span>Estado del sistema</span><strong>Configuración lista</strong><small>Agente vinculado</small></article>
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
