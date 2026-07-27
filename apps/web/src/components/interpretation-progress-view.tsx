import { UiIcon } from "./ui-icon";

interface InterpretationProgressViewProps {
  error: string | null;
  onBack: () => void;
}

export function InterpretationProgressView({ error, onBack }: InterpretationProgressViewProps) {
  const pending = ["Solicitud guardada", "Sincronizando con Notion", "Preparando ticket", "Contactando con el agente", "Imprimiendo", "Confirmación de impresión"];
  return (
    <main className="flow-screen">
      <div className="flow-card">
        <p className="wordmark flow-wordmark"><UiIcon name="printer" size={22} />PrintDesk</p>
        <header><p className="kicker">MODO SENCILLO</p><h1>Entendiendo tu ticket…</h1><p>Vertex AI está convirtiendo el mensaje en un ticket estructurado.</p></header>
        <ol className="progress-list">
          <li className={error ? "error" : "active"}>
            <span className="step-marker">{error ? "!" : <span className="spinner" />}</span>
            <span><strong>1. Interpretando con Vertex AI</strong><small>{error ? "Error" : "En proceso"}</small></span>
          </li>
          {pending.map((label, index) => (
            <li className="pending" key={label}>
              <span className="step-marker" />
              <span><strong>{index + 2}. {label}</strong><small>Pendiente</small></span>
            </li>
          ))}
        </ol>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="secondary-button" onClick={onBack} type="button">{error ? "Volver" : "Ocultar seguimiento"}</button>
      </div>
    </main>
  );
}
