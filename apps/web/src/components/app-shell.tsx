import type { User } from "firebase/auth";
import type { AppSection } from "@/lib/web-types";
import { UiIcon } from "./ui-icon";

interface AppShellProps {
  active: AppSection;
  children: React.ReactNode;
  user: User | null;
  onNavigate: (section: AppSection) => void;
}

const navigation = [
  ["home", "home", "Inicio"],
  ["compose", "plus", "Nueva solicitud"],
  ["history", "history", "Historial"],
  ["printer", "printer", "Impresora"],
  ["settings", "settings", "Ajustes"],
] as const;

export function AppShell({ active, children, user, onNavigate }: AppShellProps) {
  const firstName = user?.displayName?.split(" ")[0] ?? "Dani";
  return (
    <div className="app-frame">
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
          <p><span className="status-dot" />Configurado</p>
          <small>Tarea automática</small>
          <hr />
          <p className="micro-label">IMPRESORA CASA</p>
          <p><span className="status-dot" />Configurada</p>
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
      </header>

      <main className="app-content">{children}</main>

      <nav aria-label="Navegación móvil" className="mobile-nav">
        {navigation.filter(([section]) => section !== "compose").map(([section, icon, label]) => (
          <button className={active === section ? "active" : ""} key={section} onClick={() => onNavigate(section)} type="button">
            <UiIcon name={icon} size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
