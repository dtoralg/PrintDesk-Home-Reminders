"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import type {
  CreateRequestResult,
  PrinterCheckView,
  RequestHistoryResult,
  RequestStateResult,
} from "@printdesk/shared-models";
import { firebaseAuth, firebaseConfigured, googleProvider, preserveFirebaseSession } from "@/lib/firebase";
import type { ActiveTicket, AppSection, RecentTicket, TicketDraft } from "@/lib/web-types";
import { AppShell } from "./app-shell";
import { ComposeView } from "./compose-view";
import { HistoryView } from "./history-view";
import { HomeView } from "./home-view";
import { LoginScreen } from "./login-screen";
import { PrinterView } from "./printer-view";
import { ProgressView } from "./progress-view";
import { QueuedResultView } from "./queued-result-view";
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
  const [showQueuedResult, setShowQueuedResult] = useState(false);
  const [printerCheck, setPrinterCheck] = useState<PrinterCheckView | null>(null);
  const [printerCheckBusy, setPrinterCheckBusy] = useState(false);
  const [printerCheckError, setPrinterCheckError] = useState<string | null>(null);
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
    if (!authReady || (firebaseConfigured && !user)) return;
    const controller = new AbortController();
    void (async () => {
      const token = user ? await user.getIdToken() : null;
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const [historyResponse, checkResponse] = await Promise.all([
        fetch(`${apiBase}/v1/requests?limit=30`, { headers, signal: controller.signal }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/checks/latest`, { headers, signal: controller.signal }).catch(() => null),
      ]);
      if (historyResponse?.ok) {
        const history = await historyResponse.json() as RequestHistoryResult;
        const next = history.items.map((item): RecentTicket => ({
          requestId: item.requestId,
          jobId: item.job.jobId,
          shortUrl: item.shortUrl,
          title: item.request.title,
          type: item.request.type,
          status: item.job.status,
          important: item.request.important,
          updatedAt: item.job.updatedAt,
        }));
        setRecentTickets(next);
        localStorage.setItem(historyKey, JSON.stringify(next));
      }
      if (checkResponse?.status === 200) {
        setPrinterCheck(await checkResponse.json() as PrinterCheckView);
      }
    })();
    return () => controller.abort();
  }, [authReady, user]);

  useEffect(() => {
    if (!activeTicket) return;
    const printFinished = ["printed", "printed_simulated", "failed"].includes(activeTicket.job.status);
    const notionFinished = ["ready", "failed"].includes(activeTicket.notion.status);
    if (printFinished && notionFinished) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/requests/${activeTicket.requestId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const state = await response.json() as RequestStateResult;
      setActiveTicket((current) => current ? { ...current, job: state.job, notion: state.notion } : current);
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeTicket?.requestId, activeTicket?.job.status, activeTicket?.notion.status, user]);

  useEffect(() => {
    if (activeTicket?.job.status !== "queued") {
      setShowQueuedResult(false);
      return;
    }
    const timer = window.setTimeout(() => setShowQueuedResult(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [activeTicket?.job.jobId, activeTicket?.job.status]);

  useEffect(() => {
    if (!printerCheck || !["pending", "checking"].includes(printerCheck.status)) return;
    const controller = new AbortController();
    const poll = async () => {
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/printer-checks/${printerCheck.checkId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const next = await response.json() as PrinterCheckView;
      setPrinterCheck(next);
      if (["available", "unavailable"].includes(next.status)) {
        setPrinterCheckBusy(false);
        setPrinterCheckError(null);
      }
    };
    const interval = window.setInterval(() => void poll(), 1_500);
    const timeout = window.setTimeout(() => {
      setPrinterCheckBusy(false);
      setPrinterCheckError("El agente no ha respondido. Comprueba que el PC esté encendido.");
    }, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [printerCheck?.checkId, printerCheck?.status, user]);

  useEffect(() => {
    if (!activeTicket) return;
    const recent: RecentTicket = {
      requestId: activeTicket.requestId,
      jobId: activeTicket.job.jobId,
      shortUrl: activeTicket.shortUrl,
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
      setActiveTicket({
        requestId: result.requestId,
        shortUrl: result.shortUrl,
        draft,
        job: result.job,
        notion: result.notion,
      });
      idempotencyKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
    } finally {
      setSubmitBusy(false);
    }
  }

  async function checkPrinter() {
    setPrinterCheckBusy(true);
    setPrinterCheckError(null);
    try {
      if (firebaseConfigured && !user) throw new Error("Tu sesión ha caducado. Vuelve a acceder.");
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/printers/home/checks`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`No se pudo iniciar la comprobación (${response.status}).`);
      setPrinterCheck(await response.json() as PrinterCheckView);
    } catch (cause) {
      setPrinterCheckBusy(false);
      setPrinterCheckError(cause instanceof Error ? cause.message : "No se pudo comprobar la impresora.");
    }
  }

  function navigate(nextSection: AppSection) {
    setError(null);
    setActiveTicket(null);
    setSection(nextSection);
    window.scrollTo({ left: 0, top: 0 });
  }

  if (!authReady || (firebaseConfigured && !user)) {
    return <LoginScreen busy={loginBusy} error={error} onLogin={() => void logIn()} ready={authReady} />;
  }

  if (activeTicket && ["printed", "printed_simulated"].includes(activeTicket.job.status)) {
    return <ResultView onCreateAnother={() => navigate("compose")} onFinish={() => navigate("home")} ticket={activeTicket} user={user} />;
  }

  if (activeTicket?.job.status === "queued" && showQueuedResult) {
    return <QueuedResultView onFinish={() => navigate("home")} ticket={activeTicket} />;
  }

  if (activeTicket) {
    return <ProgressView onCancel={() => navigate(activeTicket.job.status === "failed" ? "compose" : "home")} ticket={activeTicket} />;
  }

  const pendingCount = recentTickets.filter((ticket) => !["printed", "printed_simulated", "failed"].includes(ticket.status)).length;

  return (
    <AppShell active={section} onNavigate={navigate} pendingCount={pendingCount} printerCheck={printerCheck} user={user}>
      {section === "home" && <HomeView onCompose={() => navigate("compose")} onHistory={() => navigate("history")} onPrinter={() => navigate("printer")} printerCheck={printerCheck} recentTickets={recentTickets} user={user} />}
      {section === "compose" && <ComposeView busy={submitBusy} creatorName={user?.displayName?.split(" ")[0] ?? "Tú"} error={error} onBack={() => navigate("home")} onSubmit={(draft) => void submit(draft)} />}
      {section === "history" && <HistoryView onCompose={() => navigate("compose")} tickets={recentTickets} />}
      {section === "printer" && <PrinterView check={printerCheck} checking={printerCheckBusy} error={printerCheckError} onCheck={() => void checkPrinter()} />}
      {section === "settings" && <SettingsView onSignOut={() => void signOut(firebaseAuth())} user={user} />}
    </AppShell>
  );
}
