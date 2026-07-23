import { UiIcon } from "./ui-icon";

export function PrinterView() {
  return (
    <section className="view narrow-view">
      <header className="view-header"><p className="kicker">IMPRESORA</p><h1>Impresora Casa</h1><p>Configuración actual del punto de impresión doméstico.</p></header>
      <div className="printer-hero"><div className="printer-symbol"><UiIcon name="printer" size={46} /></div><strong>Configuración preparada</strong><small>El agente de Windows se inicia automáticamente con el PC.</small></div>
      <div className="printer-details">
        <article><span><span className="status-dot" />AGENTE PC</span><strong>Inicio automático</strong><small>Suscripción: home-print-agent</small></article>
        <article><span><span className="status-dot" />IMPRESORA CASA</span><strong>TCP 9100</strong><small>192.168.1.153 · Wi-Fi</small></article>
      </div>
      <p className="info-note">El estado en tiempo real de papel, tapa y conectividad estará disponible cuando añadamos el ping manual del agente.</p>
    </section>
  );
}
