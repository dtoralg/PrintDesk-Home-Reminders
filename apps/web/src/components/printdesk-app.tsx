"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import type {
  CreateRequestResult,
  InterpretTicketResult,
  NotionSyncView,
  PaperRollView,
  PrinterCheckView,
  PrinterHealthView,
  RequestHistoryResult,
  RequestStateResult,
} from "@printdesk/shared-models";
import { firebaseAuth, firebaseConfigured, googleProvider, preserveFirebaseSession } from "@/lib/firebase";
import type { ActiveTicket, AppSection, CreationMode, RecentTicket, TicketDraft } from "@/lib/web-types";
import { AppShell } from "./app-shell";
import { HistoryView } from "./history-view";
import { HomeView } from "./home-view";
import { InterpretationProgressView } from "./interpretation-progress-view";
import { LoginScreen } from "./login-screen";
import { PrinterView } from "./printer-view";
import { ProgressView } from "./progress-view";
import { QueuedResultView } from "./queued-result-view";
import { ResultView } from "./result-view";
import { SettingsView } from "./settings-view";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const historyKey = "printdesk.recent-tickets.v1";
const creationModeKey = "printdesk.creation-mode.v1";
const pendingNotionSync: NotionSyncView = {
  status: "pending",
  url: null,
  error: null,
  updatedAt: null,
};

function readRecentTickets() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "[]");
    return Array.isArray(parsed) ? parsed as RecentTicket[] : [];
  } catch {
    return [];
  }
}

function dueLocal(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function newerPrinterCheck(current: PrinterCheckView | null, next: PrinterCheckView) {
  if (!current || current.checkId !== next.checkId) return next;
  return Date.parse(next.updatedAt) >= Date.parse(current.updatedAt) ? next : current;
}

function newerPrinterHealth(current: PrinterHealthView | null, next: PrinterHealthView) {
  if (!current) return next;
  return Date.parse(next.updatedAt) >= Date.parse(current.updatedAt) ? next : current;
}

function scrollContentToTop() {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(".app-content")?.scrollTo({ left: 0, top: 0 });
    window.scrollTo({ left: 0, top: 0 });
  });
}

export function PrintDeskApp() {
  const [authReady, setAuthReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [section, setSection] = useState<AppSection>("home");
  const [creationMode, setCreationMode] = useState<CreationMode>("simple");
  const [composeInitialDraft, setComposeInitialDraft] = useState<TicketDraft | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState(false);
  const [aiProgressError, setAiProgressError] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<ActiveTicket | null>(null);
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [showQueuedResult, setShowQueuedResult] = useState(false);
  const [printerCheck, setPrinterCheck] = useState<PrinterCheckView | null>(null);
  const [printerHealth, setPrinterHealth] = useState<PrinterHealthView | null>(null);
  const [paperRoll, setPaperRoll] = useState<PaperRollView | null>(null);
  const [paperRollBusy, setPaperRollBusy] = useState(false);
  const [paperRollError, setPaperRollError] = useState<string | null>(null);
  const [printerCheckBusy, setPrinterCheckBusy] = useState(false);
  const [printerCheckError, setPrinterCheckError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const automaticCheckFor = useRef<string | null>(null);

  useEffect(() => {
    setRecentTickets(readRecentTickets());
    const storedMode = localStorage.getItem(creationModeKey);
    if (storedMode === "simple" || storedMode === "advanced") setCreationMode(storedMode);
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
      const [historyResponse, checkResponse, healthResponse, paperRollResponse] = await Promise.all([
        fetch(`${apiBase}/v1/requests?limit=30`, { headers, signal: controller.signal }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/checks/latest`, { headers, signal: controller.signal }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/health`, { headers, signal: controller.signal }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/paper-roll`, { headers, signal: controller.signal }).catch(() => null),
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
        const nextCheck = await checkResponse.json() as PrinterCheckView;
        setPrinterCheck((current) => newerPrinterCheck(current, nextCheck));
      }
      if (healthResponse?.status === 200) {
        const nextHealth = await healthResponse.json() as PrinterHealthView;
        setPrinterHealth((current) => newerPrinterHealth(current, nextHealth));
      }
      if (paperRollResponse?.status === 200) {
        setPaperRoll(await paperRollResponse.json() as PaperRollView);
      }
      const actorKey = user?.uid ?? "local";
      if (automaticCheckFor.current !== actorKey && !controller.signal.aborted) {
        automaticCheckFor.current = actorKey;
        setPrinterCheckBusy(true);
        setPrinterCheckError(null);
        const automaticResponse = await fetch(`${apiBase}/v1/printers/home/checks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ source: "startup_check" }),
          signal: controller.signal,
        }).catch(() => null);
        if (automaticResponse?.ok) {
          const nextCheck = await automaticResponse.json() as PrinterCheckView;
          setPrinterCheck((current) => newerPrinterCheck(current, nextCheck));
        } else {
          setPrinterCheckBusy(false);
          setPrinterCheckError(`No se pudo iniciar la comprobación automática${automaticResponse ? ` (${automaticResponse.status})` : ""}.`);
        }
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
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const [response, healthResponse, paperRollResponse] = await Promise.all([
        fetch(`${apiBase}/v1/requests/${activeTicket.requestId}`, {
          headers,
          signal: controller.signal,
        }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/health`, {
          headers,
          signal: controller.signal,
        }).catch(() => null),
        fetch(`${apiBase}/v1/printers/home/paper-roll`, {
          headers,
          signal: controller.signal,
        }).catch(() => null),
      ]);
      if (!response?.ok) return;
      const state = await response.json() as RequestStateResult;
      setActiveTicket((current) => current
        ? { ...current, job: state.job, notion: state.notion ?? pendingNotionSync }
        : current);
      if (healthResponse?.ok) {
        const nextHealth = await healthResponse.json() as PrinterHealthView;
        setPrinterHealth((current) => newerPrinterHealth(current, nextHealth));
      }
      if (paperRollResponse?.ok) setPaperRoll(await paperRollResponse.json() as PaperRollView);
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
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const token = user ? await user.getIdToken() : null;
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        const response = await fetch(`${apiBase}/v1/printer-checks/${printerCheck.checkId}`, {
          headers,
          signal: controller.signal,
        }).catch(() => null);
        if (!response?.ok) return;
        const next = await response.json() as PrinterCheckView;
        setPrinterCheck((current) => newerPrinterCheck(current, next));
        const healthResponse = await fetch(`${apiBase}/v1/printers/home/health`, {
          headers,
          signal: controller.signal,
        }).catch(() => null);
        if (healthResponse?.ok) {
          const nextHealth = await healthResponse.json() as PrinterHealthView;
          setPrinterHealth((current) => newerPrinterHealth(current, nextHealth));
        }
        if (["available", "unavailable"].includes(next.status)) {
          setPrinterCheckBusy(false);
          setPrinterCheckError(next.status === "unavailable"
            ? next.error ?? "La impresora no ha respondido a la prueba TCP."
            : null);
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_500);
    const timeout = window.setTimeout(async () => {
      const token = user ? await user.getIdToken() : null;
      const headers = token ? { authorization: `Bearer ${token}` } : {};
      const timeoutResponse = await fetch(`${apiBase}/v1/printer-checks/${printerCheck.checkId}/timeout`, {
        method: "POST",
        headers,
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      const timedCheck = timeoutResponse?.ok
        ? await timeoutResponse.json() as PrinterCheckView
        : null;
      if (timedCheck) setPrinterCheck((current) => newerPrinterCheck(current, timedCheck));
      const healthResponse = await fetch(`${apiBase}/v1/printers/home/health`, {
        headers,
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      if (healthResponse?.ok) {
        const nextHealth = await healthResponse.json() as PrinterHealthView;
        setPrinterHealth((current) => newerPrinterHealth(current, nextHealth));
      }
      setPrinterCheckBusy(false);
      setPrinterCheckError(timedCheck?.status === "available"
        ? null
        : timedCheck?.error
          ?? (timedCheck?.status === "checking"
            ? "El agente respondió, pero la impresora no completó la prueba TCP."
            : "El agente no ha respondido. Comprueba que el PC esté encendido."));
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
      const { dueLocal: _dueLocal, interpretedByAi: _interpretedByAi, ...request } = draft;
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
        // Keep the web compatible with an older API revision while Cloud Run
        // rolls services independently.
        notion: result.notion ?? pendingNotionSync,
        ...(draft.interpretedByAi ? { interpretedByAi: true } : {}),
      });
      idempotencyKey.current = null;
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado.");
      return false;
    } finally {
      setSubmitBusy(false);
    }
  }

  async function interpretTicket(text: string) {
    if (firebaseConfigured && !user) throw new Error("Tu sesión ha caducado. Vuelve a acceder.");
    const token = user ? await user.getIdToken() : null;
    const response = await fetch(`${apiBase}/v1/tickets/interpret`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`No se pudo interpretar el ticket (${response.status}).`);
    const result = await response.json() as InterpretTicketResult;
    return {
      ...result.request,
      dueLocal: dueLocal(result.request.dueAt),
      interpretedByAi: true,
    } satisfies TicketDraft;
  }

  async function printWithAi(text: string) {
    setAiBusy(true);
    setAiError(null);
    setAiProgressError(null);
    setAiProgress(true);
    try {
      const draft = await interpretTicket(text);
      const submitted = await submit(draft);
      if (!submitted) setAiProgressError("Vertex completó el ticket, pero no se pudo guardarlo.");
      else setAiProgress(false);
    } catch (cause) {
      setAiProgressError(cause instanceof Error ? cause.message : "No se pudo interpretar el ticket.");
    } finally {
      setAiBusy(false);
    }
  }

  async function reviewWithAi(text: string) {
    setAiBusy(true);
    setAiError(null);
    setError(null);
    try {
      const draft = await interpretTicket(text);
      setComposeInitialDraft(draft);
      setCreationMode("advanced");
      localStorage.setItem(creationModeKey, "advanced");
      setSection("home");
      scrollContentToTop();
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "No se pudo interpretar el ticket.");
    } finally {
      setAiBusy(false);
    }
  }

  function changeCreationMode(mode: CreationMode) {
    setCreationMode(mode);
    setAiError(null);
    localStorage.setItem(creationModeKey, mode);
  }

  async function checkPrinter() {
    setPrinterCheckBusy(true);
    setPrinterCheckError(null);
    try {
      if (firebaseConfigured && !user) throw new Error("Tu sesión ha caducado. Vuelve a acceder.");
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/printers/home/checks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ source: "manual_check" }),
      });
      if (!response.ok) throw new Error(`No se pudo iniciar la comprobación (${response.status}).`);
      const nextCheck = await response.json() as PrinterCheckView;
      setPrinterCheck((current) => newerPrinterCheck(current, nextCheck));
    } catch (cause) {
      setPrinterCheckBusy(false);
      setPrinterCheckError(cause instanceof Error ? cause.message : "No se pudo comprobar la impresora.");
    }
  }

  async function replacePaperRoll(lengthMeters: number) {
    setPaperRollBusy(true);
    setPaperRollError(null);
    try {
      if (firebaseConfigured && !user) throw new Error("Tu sesión ha caducado. Vuelve a acceder.");
      const token = user ? await user.getIdToken() : null;
      const response = await fetch(`${apiBase}/v1/printers/home/paper-roll`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lengthMeters }),
      });
      if (!response.ok) throw new Error(`No se pudo registrar el rollo (${response.status}).`);
      setPaperRoll(await response.json() as PaperRollView);
    } catch (cause) {
      setPaperRollError(cause instanceof Error ? cause.message : "No se pudo registrar el cambio de rollo.");
      throw cause;
    } finally {
      setPaperRollBusy(false);
    }
  }

  function navigate(nextSection: AppSection) {
    setError(null);
    setActiveTicket(null);
    setAiProgress(false);
    setAiProgressError(null);
    setComposeInitialDraft(null);
    setSection(nextSection);
    scrollContentToTop();
  }

  function openAdvanced(initialDraft: TicketDraft | null = null) {
    setError(null);
    setActiveTicket(null);
    setAiProgress(false);
    setAiProgressError(null);
    setComposeInitialDraft(initialDraft);
    setCreationMode("advanced");
    localStorage.setItem(creationModeKey, "advanced");
    setSection("home");
    scrollContentToTop();
  }

  if (!authReady || (firebaseConfigured && !user)) {
    return <LoginScreen busy={loginBusy} error={error} onLogin={() => void logIn()} ready={authReady} />;
  }

  if (aiProgress && !activeTicket) {
    return <InterpretationProgressView error={aiProgressError} onBack={() => navigate("home")} />;
  }

  if (activeTicket && ["printed", "printed_simulated"].includes(activeTicket.job.status)) {
    return <ResultView onCreateAnother={() => openAdvanced()} onFinish={() => navigate("home")} ticket={activeTicket} user={user} />;
  }

  if (activeTicket?.job.status === "queued" && showQueuedResult) {
    return <QueuedResultView onFinish={() => navigate("home")} ticket={activeTicket} />;
  }

  if (activeTicket) {
    return <ProgressView onCancel={() => activeTicket.job.status === "failed" ? openAdvanced(activeTicket.draft) : navigate("home")} ticket={activeTicket} />;
  }

  const pendingCount = recentTickets.filter((ticket) => !["printed", "printed_simulated", "failed"].includes(ticket.status)).length;

  return (
    <AppShell active={section} health={printerHealth} onNavigate={navigate} pendingCount={pendingCount} user={user}>
      {section === "home" && <HomeView aiBusy={aiBusy} aiError={aiError} composeBusy={submitBusy} composeError={error} composeInitialDraft={composeInitialDraft} health={printerHealth} mode={creationMode} onAiPrint={(text) => void printWithAi(text)} onAiReview={(text) => void reviewWithAi(text)} onHistory={() => navigate("history")} onModeChange={changeCreationMode} onPrinter={() => navigate("printer")} onSubmit={(draft) => void submit(draft)} paperRoll={paperRoll} recentTickets={recentTickets} user={user} />}
      {section === "history" && <HistoryView onCompose={() => openAdvanced()} tickets={recentTickets} />}
      {section === "printer" && <PrinterView check={printerCheck} checking={printerCheckBusy} error={printerCheckError} health={printerHealth} onCheck={() => void checkPrinter()} />}
      {section === "settings" && <SettingsView onReplacePaperRoll={replacePaperRoll} onSignOut={() => void signOut(firebaseAuth())} paperRoll={paperRoll} paperRollBusy={paperRollBusy} paperRollError={paperRollError} user={user} />}
    </AppShell>
  );
}
