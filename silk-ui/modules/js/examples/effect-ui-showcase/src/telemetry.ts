import { MessageLog } from "@effect/ui";
import { Layer } from "effect";

export interface TelemetryEvent {
  readonly seq: number;
  readonly tag: string;
  readonly path: string;
  readonly detail: string;
  readonly trigger: string;
  readonly time: string;
}

const MAX_EVENTS = 80;
let seq = 0;
let totalMessages = 0;
let events: TelemetryEvent[] = [];
const listeners = new Set<() => void>();
let pendingNotify = false;

function notify() {
  if (pendingNotify) return;
  pendingNotify = true;
  queueMicrotask(() => {
    pendingNotify = false;
    for (const listener of listeners) listener();
  });
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function summarize(entry: MessageLog.Entry): TelemetryEvent | null {
  if (entry._tag === "SessionStarted") return null;
  const path = "path" in entry && typeof entry.path === "string" ? entry.path : "/";
  // Avoid feedback/noise from the telemetry inspector and the 1s memory poller.
  if (path.includes("TelemetryView") || path.includes("MemoryBadge")) return null;

  if (entry._tag === "Update") {
    totalMessages++;
    const msg = entry.message as { readonly _tag?: string } | null | undefined;
    const detail = msg && typeof msg === "object" && typeof msg._tag === "string"
      ? msg._tag
      : String(msg ?? "Update");
    const trigger = entry.source?._tag ?? "Message";
    return {
      seq: ++seq,
      tag: "Update",
      path,
      detail,
      trigger,
      time: nowStamp(),
    };
  }

  if (entry._tag === "Mounted") {
    return {
      seq: ++seq,
      tag: "Mounted",
      path,
      detail: "Component mounted",
      trigger: "Lifecycle",
      time: nowStamp(),
    };
  }

  if (entry._tag === "FetchStarted") {
    return {
      seq: ++seq,
      tag: "Query",
      path: `query:${entry.query}`,
      detail: entry.logKey,
      trigger: entry.trigger,
      time: nowStamp(),
    };
  }

  if (entry._tag === "CommandStarted" || entry._tag === "CommandEnded") {
    return {
      seq: ++seq,
      tag: "Command",
      path,
      detail: `${entry.name} (${entry._tag === "CommandStarted" ? "started" : "completed"})`,
      trigger: "Effect",
      time: nowStamp(),
    };
  }

  return null;
}

export const telemetry = {
  getEvents(): readonly TelemetryEvent[] {
    return events;
  },
  getTotalMessages(): number {
    return totalMessages;
  },
  clear() {
    events = [];
    notify();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const TelemetryLayer = Layer.succeed(MessageLog.MessageLog, {
  enabled: true,
  record(entry) {
    const item = summarize(entry);
    if (!item) return;
    events = [item, ...events.slice(0, MAX_EVENTS - 1)];
    notify();
  },
});
