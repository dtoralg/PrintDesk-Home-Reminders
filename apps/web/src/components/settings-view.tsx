"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { PaperRollView } from "@printdesk/shared-models";
import { UiIcon } from "./ui-icon";

interface SettingsViewProps {
  user: User | null;
  paperRoll: PaperRollView | null;
  paperRollBusy: boolean;
  paperRollError: string | null;
  onReplacePaperRoll: (lengthMeters: number) => Promise<void>;
  onSignOut: () => void;
}

export function SettingsView({
  user,
  paperRoll,
  paperRollBusy,
  paperRollError,
  onReplacePaperRoll,
  onSignOut,
}: SettingsViewProps) {
  const [length, setLength] = useState("80");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (paperRoll) setLength(String(paperRoll.lengthMeters));
  }, [paperRoll]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number(length.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 200) return;
    setSaved(false);
    try {
      await onReplacePaperRoll(parsed);
      setSaved(true);
    } catch {
      // The parent exposes the API error next to this form.
    }
  }

  return (
    <section className="view narrow-view">
      <header className="view-header"><p className="kicker">AJUSTES</p><h1>Tu cuenta.</h1><p>Identidad autorizada para utilizar PrintDesk.</p></header>
      <article className="account-card">
        <span className="large-avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? "D"}</span>
        <div><strong>{user?.displayName ?? "Modo local"}</strong><small>{user?.email ?? "Firebase no configurado"}</small></div>
      </article>

      <form className="paper-roll-card" onSubmit={(event) => void submit(event)}>
        <div className="paper-roll-heading">
          <span className="printer-symbol compact"><UiIcon name="printer" size={24} /></span>
          <span><small>CONSUMIBLE</small><strong>Cambio de rollo</strong></span>
        </div>
        <p>Indica la longitud del rollo nuevo. El consumo volverá a cero y se calculará con cada ticket impreso.</p>
        <label htmlFor="roll-length">Longitud del rollo</label>
        <div className="paper-roll-input">
          <input
            id="roll-length"
            inputMode="decimal"
            max="200"
            min="0.1"
            onChange={(event) => {
              setLength(event.target.value);
              setSaved(false);
            }}
            step="0.1"
            type="number"
            value={length}
          />
          <span>metros</span>
        </div>
        {paperRoll && (
          <small className="paper-roll-current">
            Rollo actual: {paperRoll.remainingMeters.toLocaleString("es-ES", { maximumFractionDigits: 1 })} m restantes de {paperRoll.lengthMeters.toLocaleString("es-ES")} m
          </small>
        )}
        {paperRollError && <p className="form-error" role="alert">{paperRollError}</p>}
        {saved && <p className="form-success" role="status">Rollo nuevo registrado.</p>}
        <button className="primary-button" disabled={paperRollBusy} type="submit">
          {paperRollBusy ? <><span className="spinner inverse-spinner" />Guardando</> : "Registrar cambio de rollo"}
        </button>
      </form>

      {user && <button className="secondary-button logout-button" onClick={onSignOut} type="button"><UiIcon name="logout" size={18} />Cerrar sesión</button>}
    </section>
  );
}
