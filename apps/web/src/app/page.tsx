import { TicketComposer } from "@/components/ticket-composer";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">PRINTDESK<span aria-hidden="true">_</span></a>
        <p className="system-state"><span className="dot" />RECORRIDO LOCAL</p>
      </header>
      <section className="hero">
        <p className="eyebrow">NUEVO TICKET / MILESTONE 01</p>
        <h1>Saca una tarea<br />del ruido digital.</h1>
        <p>La API valida el contenido, Pillow prepara el ticket y el agente local lo recoge como ESC/POS.</p>
      </section>
      <TicketComposer />
    </main>
  );
}
