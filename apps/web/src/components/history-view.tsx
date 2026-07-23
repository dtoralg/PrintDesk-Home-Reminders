import type { RecentTicket } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface HistoryViewProps {
  tickets: RecentTicket[];
  onCompose: () => void;
}

export function HistoryView({ tickets, onCompose }: HistoryViewProps) {
  return (
    <section className="view">
      <header className="view-header"><p className="kicker">HISTORIAL</p><h1>Tus tickets.</h1><p>Solicitudes recientes guardadas en este dispositivo.</p></header>
      <div className="history-list">
        {tickets.length ? tickets.map((ticket) => (
          <article key={ticket.jobId}>
            <span className="recent-icon"><UiIcon name={ticket.type} size={20} /></span>
            <div><strong>{ticket.title}</strong><small>{new Date(ticket.updatedAt).toLocaleString("es-ES")}</small></div>
            <span className={`status-badge status-${ticket.status}`}>{ticket.status.replaceAll("_", " ").toUpperCase()}</span>
          </article>
        )) : <div className="empty-state"><UiIcon name="history" size={28} /><p>No hay tickets recientes.</p><button className="primary-button" onClick={onCompose} type="button">Crear el primero</button></div>}
      </div>
    </section>
  );
}
