"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import type { CreateRequestResult, PrintJobView } from "@printdesk/shared-models";
import { firebaseAuth, firebaseConfigured, googleProvider, preserveFirebaseSession } from "@/lib/firebase";
import type { ActiveTicket, AppSection, RecentTicket, TicketDraft } from "@/lib/web-types";
import { AppShell } from "./app-shell";
import { ComposeView } from "./compose-view";
import { HistoryView } from "./history-view";
import { HomeView } from "./home-view";
import { LoginScreen } from "./login-screen";
import { PrinterView } from "./printer-view";
import { ProgressView } from "./progress-view";
import { ResultView } from "./result-view";
import { SettingsView } from "./settings-view";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const historyKey = "printdesk.recent-tickets.v1";

function readRecentTickets() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "[]");
    return Array.isArray(parsed) ? parsed as RecentTicket[] : [];
  } catch {
    return [];
  }
}

export function PrintDeskApp() {
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [section, setSection] = useState<AppSection>("home");
  const [activeTicket, setActiveTicket] = useState<ActiveTicket | null>(null);
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    setRecentTickets(readRecentTickets());
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    return onAuthStateChanged(firebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!activeTicket || ["printed", "printed_simulated", "failed"].includes(activeTicket.job.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/print-jobs/${activeTicket.job.jobId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const job = await response.json() as PrintJobView;
      setActiveTicket((current) => current ? { ...current, job } : current);
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeTicket?.job.jobId, activeTicket?.job.status, user]);

  useEffect(() => {
    if (!activeTicket) return;
    const recent: RecentTicket = {
      requestId: activeTicket.requestId,
      jobId: activeTicket.job.jobId,
      title: activeTicket.draft.title,
      type: activeTicket.draft.type,
      status: activeTicket.job.status,
      important: activeTicket.draft.important,
      updatedAt: activeTicket.job.updatedAt,
    };
    setRecentTickets((current) => {
      const next = [recent, ...current.filter((item) => item.jobId !== recent.jobId)].slice(0, 30);
      localStorage.setItem(historyKey, JSON.stringify(next));
      return next;
    });
  }, [activeTicket]);

  async function logIn() {
    setLoginBusy(true);
    setError(null);
    try {
      await preserveFirebaseSession();
      await signInWithPopup(firebaseAuth(), googleProvider());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function submit(draft: TicketDraft) {
    setSubmitBusy(true);
    setError(null);
    try {
      if (firebaseConfigured && !user) throw new Error("Tu sesión ha caducado. Vuelve a acceder.");
      idempotencyKey.current ??= crypto.randomUUID();
      const token = user ? await user.getIdToken() : null;
      const { dueLocal: _dueLocal, ...request } = draft;
      const response = await fetch(`${apiBase}/v1/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ request, printerId: "home", source: "pwa" }),
      });
      if (!response.ok) throw new Error(`No se pudo preparar el ticket (${response.status}).`);
      const result = await response.json() as CreateRequestResult;
      setActiveTicket({ requestId: result.requestId, shortUrl: result.shortUrl, draft, job: result.job });
      idempotencyKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setSubmitBusy(false);
    }
  }

  function navigate(nextSection: AppSection) {
    setError(null);
    setActiveTicket(null);
    setSection(nextSection);
  }

  if (!authReady || (firebaseConfigured && !user)) {
    return <LoginScreen busy={loginBusy} error={error} onLogin={() => void logIn()} ready={authReady} />;
  }

  if (activeTicket && ["printed", "printed_simulated"].includes(activeTicket.job.status)) {
    return <ResultView onCreateAnother={() => navigate("compose")} onFinish={() => navigate("home")} ticket={activeTicket} user={user} />;
  }

  if (activeTicket) {
    return <ProgressView onCancel={() => navigate(activeTicket.job.status === "failed" ? "compose" : "home")} ticket={activeTicket} />;
  }

  return (
    <AppShell active={section} onNavigate={navigate} user={user}>
      {section === "home" && <HomeView onCompose={() => setSection("compose")} onHistory={() => setSection("history")} recentTickets={recentTickets} user={user} />}
      {section === "compose" && <ComposeView busy={submitBusy} error={error} onBack={() => navigate("home")} onSubmit={(draft) => void submit(draft)} />}
      {section === "history" && <HistoryView onCompose={() => setSection("compose")} tickets={recentTickets} />}
      {section === "printer" && <PrinterView />}
      {section === "settings" && <SettingsView onSignOut={() => void signOut(firebaseAuth())} user={user} />}
    </AppShell>
  );
}
