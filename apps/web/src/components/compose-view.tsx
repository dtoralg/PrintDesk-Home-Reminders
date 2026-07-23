"use client";

import { useState, type FormEvent } from "react";
import type { RequestType } from "@printdesk/shared-models";
import type { TicketDraft } from "@/lib/web-types";
import { TicketPreview } from "./ticket-preview";
import { UiIcon } from "./ui-icon";

interface ComposeViewProps {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (draft: TicketDraft) => void;
}

const requestTypes: Array<{ value: RequestType; label: string }> = [
  { value: "task", label: "Tarea" },
  { value: "idea", label: "Idea" },
  { value: "reminder", label: "Recordatorio" },
  { value: "note", label: "Nota" },
];

export function ComposeView({ busy, error, onBack, onSubmit }: ComposeViewProps) {
  const [draft, setDraft] = useState<TicketDraft>({
    type: "task",
    title: "",
    body: "",
    important: false,
    dueAt: null,
    dueLocal: "",
  });

  function update(values: Partial<TicketDraft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      ...draft,
      title: draft.title.trim(),
      body: draft.body.trim(),
      dueAt: draft.dueLocal ? new Date(draft.dueLocal).toISOString() : null,
    });
  }

  return (
    <section className="view compose-view">
      <header className="compose-header">
        <button className="icon-button" onClick={onBack} type="button" aria-label="Volver">←</button>
        <div><p className="kicker">NUEVA SOLICITUD</p><h1>Nuevo ticket</h1></div>
        <span className="mode-badge">MODO SIMPLE</span>
      </header>

      <div className="compose-grid">
        <form className="ticket-form" onSubmit={submit}>
          <fieldset>
            <legend>TIPO DE TICKET</legend>
            <div className="request-type-grid">
              {requestTypes.map(({ value, label }) => (
                <button className={draft.type === value ? "selected" : ""} key={value} onClick={() => update({ type: value })} type="button">
                  <UiIcon name={value} size={23} /><span>{label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label htmlFor="ticket-title">TÍTULO</label>
          <input id="ticket-title" maxLength={120} onChange={(event) => update({ title: event.target.value })} placeholder="Llamar a Sanitas" required value={draft.title} />

          <label htmlFor="ticket-body">MENSAJE / DETALLES</label>
          <textarea id="ticket-body" maxLength={2000} onChange={(event) => update({ body: event.target.value })} placeholder="Preguntar por la cobertura dental y pedir presupuesto." rows={5} value={draft.body} />

          <div className="form-options">
            <label className="toggle-row">
              <span>Importante</span>
              <input checked={draft.important} onChange={(event) => update({ important: event.target.checked })} type="checkbox" />
              <span className="toggle" aria-hidden="true" />
            </label>
            <label className="date-field" htmlFor="ticket-date">
              <UiIcon name="calendar" size={18} />
              <span>Fecha (opcional)</span>
              <input id="ticket-date" onChange={(event) => update({ dueLocal: event.target.value })} type="datetime-local" value={draft.dueLocal} />
            </label>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy || !draft.title.trim()} type="submit">
            <span>{busy ? "Guardando…" : "Guardar e imprimir"}</span><UiIcon name="arrow" size={19} />
          </button>
          <p className="form-footnote">Se preparará el ticket y se imprimirá cuando el agente esté disponible.</p>
        </form>

        <aside className="preview-column">
          <p className="micro-label">VISTA PREVIA DEL TICKET</p>
          <TicketPreview draft={draft} />
        </aside>
      </div>
    </section>
  );
}
