import type { TicketDraft } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface TicketPreviewProps {
  creatorName: string;
  draft: TicketDraft;
}

const labels = { task: "TASK", idea: "IDEA", reminder: "RECORDATORIO", note: "NOTA" } as const;

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
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function TicketPreview({ creatorName, draft }: TicketPreviewProps) {
  const due = formatDueDate(draft.dueLocal);
  const createdAt = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

  return (
    <article className="ticket-preview">
      <div className="preview-kind">
        <span><UiIcon name={draft.type} size={18} />{labels[draft.type]}</span>
        {draft.important && <span aria-label="Importante">★</span>}
      </div>
      <h2>{draft.title.trim() || "Título del ticket"}</h2>
      <div className="preview-rule" />
      <p>{draft.body.trim() || "El detalle de tu solicitud aparecerá aquí."}</p>
      {due && <p className="preview-date"><UiIcon name="calendar" size={15} />{due}</p>}
      <footer className="preview-footer">
        <div>
          <span><UiIcon name="user" size={13} />{creatorName}</span>
          <span><UiIcon name="calendar" size={13} />{createdAt}</span>
        </div>
        <div className="fake-qr" aria-hidden="true">
          {Array.from({ length: 121 }, (_, index) => <span className={qrCellFilled(index) ? "filled" : ""} key={index} />)}
        </div>
      </footer>
    </article>
  );
}
