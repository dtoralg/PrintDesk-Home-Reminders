import type { User } from "firebase/auth";
import type { PrinterHealthView } from "@printdesk/shared-models";
import type { AppSection } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface AppShellProps {
  active: AppSection;
  children: React.ReactNode;
  pendingCount: number;
  health: PrinterHealthView | null;
  user: User | null;
  onNavigate: (section: AppSection) => void;
}

const navigation = [
  ["home", "home", "Inicio"],
  ["history", "history", "Historial"],
  ["printer", "printer", "Impresora"],
  ["settings", "settings", "Ajustes"],
] as const;

export function AppShell({ active, children, pendingCount, health, user, onNavigate }: AppShellProps) {
  const firstName = user?.displayName?.split(" ")[0] ?? "Dani";
  const agentLabel = health?.agentStatus === "online"
    ? "Conectado"
    : health?.agentStatus === "offline"
      ? "Desconectado"
      : health?.agentStatus === "checking"
        ? "Contactando"
        : "Sin comprobar";
  const printerLabel = health?.printerStatus === "available"
    ? "Disponible"
    : health?.printerStatus === "unavailable"
      ? "No disponible"
      : health?.printerStatus === "checking"
        ? "Comprobando"
        : "Sin comprobar";
  const agentDotClass = `status-dot ${health?.agentStatus === "online" ? "online" : health?.agentStatus === "offline" ? "offline" : "checking"}`;
  const printerDotClass = `status-dot ${health?.printerStatus === "available" ? "online" : health?.printerStatus === "unavailable" ? "offline" : "checking"}`;
  return (
    <div className={`app-frame section-${active}`}>
      <aside className="sidebar">
        <button className="wordmark wordmark-button" onClick={() => onNavigate("home")} type="button">
          <UiIcon name="printer" size={23} />PrintDesk
        </button>
        <nav aria-label="Navegación principal">
          {navigation.map(([section, icon, label]) => (
            <button className={active === section ? "nav-item active" : "nav-item"} key={section} onClick={() => onNavigate(section)} type="button">
              <UiIcon name={icon} size={17} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <p className="micro-label">AGENTE PC</p>
          <p><span className={agentDotClass} />{agentLabel}</p>
          <small>{health?.lastAgentSeenAt ? "Respuesta confirmada" : "Comprobación automática"}</small>
          <hr />
          <p className="micro-label">IMPRESORA CASA</p>
          <p><span className={printerDotClass} />{printerLabel}</p>
          <small>TCP / 192.168.1.153</small>
        </div>
        <button className="profile-button" onClick={() => onNavigate("settings")} type="button">
          <span className="avatar">{firstName.slice(0, 1).toUpperCase()}</span>
          <span>{firstName}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </aside>

      <header className="mobile-header">
        <button className="wordmark wordmark-button" onClick={() => onNavigate("home")} type="button">
          <UiIcon name="printer" size={20} />PrintDesk
        </button>
        <button aria-label="Notificaciones y pendientes" className="mobile-alert-button" onClick={() => onNavigate("history")} type="button">
          <UiIcon name="bell" size={19} />
          {pendingCount > 0 && <span>{pendingCount}</span>}
        </button>
      </header>

      <main className="app-content">{children}</main>

      <nav aria-label="Navegación móvil" className="mobile-nav">
        {navigation.map(([section, icon, label]) => (
          <button className={active === section ? "active" : ""} key={section} onClick={() => onNavigate(section)} type="button">
            <UiIcon name={icon} size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
