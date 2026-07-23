import type { User } from "firebase/auth";
import { UiIcon } from "./ui-icon";

interface SettingsViewProps {
  user: User | null;
  onSignOut: () => void;
}

export function SettingsView({ user, onSignOut }: SettingsViewProps) {
  return (
    <section className="view narrow-view">
      <header className="view-header"><p className="kicker">AJUSTES</p><h1>Tu cuenta.</h1><p>Identidad autorizada para utilizar PrintDesk.</p></header>
      <article className="account-card">
        <span className="large-avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? "D"}</span>
        <div><strong>{user?.displayName ?? "Modo local"}</strong><small>{user?.email ?? "Firebase no configurado"}</small></div>
      </article>
      {user && <button className="secondary-button logout-button" onClick={onSignOut} type="button"><UiIcon name="logout" size={18} />Cerrar sesión</button>}
    </section>
  );
}
