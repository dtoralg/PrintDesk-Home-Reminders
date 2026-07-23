import type { TicketDraft } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface TicketPreviewProps {
  draft: TicketDraft;
}

const labels = { task: "TAREA", idea: "IDEA", reminder: "RECORDATORIO", note: "NOTA" } as const;

function qrCellFilled(index: number) {
  const x = index % 11;
  const y = Math.floor(index / 11);
  const inFinder = (originX: number, originY: number) => {
    const localX = x - originX;
    const localY = y - originY;
    if (localX < 0 || localX > 4 || localY < 0 || localY > 4) return false;
    return localX === 0 || localX === 4 || localY === 0 || localY === 4 || (localX === 2 && localY === 2);
  };
  return inFinder(0, 0) || inFinder(6, 0) || inFinder(0, 6) || ((x * 3 + y * 5 + x * y) % 7 < 3);
}

function formatDueDate(value: string) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function TicketPreview({ draft }: TicketPreviewProps) {
  const due = formatDueDate(draft.dueLocal);
  return (
    <article className="ticket-preview">
      <div className="preview-kind"><span>{labels[draft.type]}</span><span>{draft.important ? "★" : "☆"}</span></div>
      <h2>{draft.title.trim() || "Título del ticket"}</h2>
      <div className="preview-rule" />
      <p>{draft.body.trim() || "El detalle de tu solicitud aparecerá aquí."}</p>
      {due && <p className="preview-date"><UiIcon name="calendar" size={15} />{due}</p>}
      <div className="fake-qr" aria-hidden="true">
        {Array.from({ length: 121 }, (_, index) => <span className={qrCellFilled(index) ? "filled" : ""} key={index} />)}
      </div>
      <small>ABRIR NOTA VIVA</small>
    </article>
  );
}
