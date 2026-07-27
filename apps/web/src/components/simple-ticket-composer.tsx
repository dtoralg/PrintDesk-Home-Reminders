"use client";

import { useState } from "react";
import { UiIcon } from "./ui-icon";

interface SimpleTicketComposerProps {
  busy: boolean;
  error: string | null;
  onAdvanced: () => void;
  onPrint: (text: string) => void;
  onReview: (text: string) => void;
}

const examples = [
  "Recuérdame comprar leche mañana",
  "Llamar a Sanitas por la cobertura dental",
  "Idea para reorganizar el escritorio",
];

export function SimpleTicketComposer({ busy, error, onAdvanced, onPrint, onReview }: SimpleTicketComposerProps) {
  const [text, setText] = useState("");
  const valid = text.trim().length >= 3;

  return (
    <section className="ai-composer" aria-label="Crear ticket con inteligencia artificial">
      <div className="ai-composer-heading">
        <span className="ai-mark"><UiIcon name="sparkles" size={22} /></span>
        <span><strong>¿Qué quieres imprimir?</strong><small>Escríbelo como se lo contarías a una persona.</small></span>
      </div>
      <div className="ai-input-shell">
        <textarea
          aria-label="Describe el ticket"
          disabled={busy}
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && valid && !busy) onPrint(text.trim());
          }}
          placeholder="Ej.: Recuérdame mañana comprar leche y llamar al dentista. Es importante."
          rows={4}
          value={text}
        />
        <span>{text.length}/2000</span>
      </div>
      <div className="ai-examples" aria-label="Ejemplos">
        {examples.map((example) => (
          <button disabled={busy} key={example} onClick={() => setText(example)} type="button">{example}</button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="ai-actions">
        <button className="primary-button" disabled={!valid || busy} onClick={() => onPrint(text.trim())} type="button">
          {busy ? <><span className="spinner inverse-spinner" />Interpretando</> : <><UiIcon name="sparkles" size={17} />Imprimir</>}
        </button>
        <button className="secondary-button" disabled={!valid || busy} onClick={() => onReview(text.trim())} type="button">
          Revisar e imprimir <UiIcon name="arrow" size={17} />
        </button>
      </div>
      <button className="ai-advanced-button" disabled={busy} onClick={onAdvanced} type="button">
        <UiIcon name="settings" size={16} />Crear manualmente en Modo Avanzado
      </button>
      <p className="ai-hint">PrintDesk inferirá el tipo, título, detalles, importancia y fecha. <span>Ctrl + Enter para imprimir.</span></p>
    </section>
  );
}
