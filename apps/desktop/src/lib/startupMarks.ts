// Structured startup instrumentation. Each startup phase is recorded as a real
// performance.mark (visible in the DevTools performance panel) and kept in an
// in-memory buffer; flushStartupMarks writes one timing summary line into the
// debug log. This replaces the previous ad-hoc console.log(performance.now())
// timing, which never reached the exported debug log.
//
// Debug logging is off by default and the debugLog buffer may not exist yet
// while the earliest phases run, so marks are buffered here first and flushed
// (once, without duplicates) when the summary can actually land: after the
// first frame, at the end of the awaited init chain, or when the user enables
// debug logging after boot.
import { appendDebugLog, isDebugLoggingEnabled, onDebugLoggingEnabled } from "@/lib/debugLog";

export interface StartupPhaseRecord {
  phase: string;
  /** Milliseconds on the monotonic clock (time origin for performance.now()). */
  atMs: number;
  /** Gap to the previous mark; null for the first mark. */
  sincePrevMs: number | null;
}

interface StartupMark {
  phase: string;
  atMs: number;
}

const marks: StartupMark[] = [];
// How many marks the last appended summary covered; marks stay in memory until
// a summary actually lands in the debug log.
let flushedMarkCount = 0;

function monotonicNowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function emitUserTimingMark(phase: string) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(phase);
  } catch {
    // Some WebViews restrict user timing marks; losing the DevTools entry is
    // fine, losing startup must not happen.
  }
}

// Idempotent: a phase is recorded on its first call only, so re-entry (theme
// re-apply, hot reload) cannot distort the summary.
export function markStartupPhase(phase: string) {
  if (marks.some((mark) => mark.phase === phase)) return;
  emitUserTimingMark(phase);
  marks.push({ phase, atMs: monotonicNowMs() });
}

export function getStartupPhaseRecords(): StartupPhaseRecord[] {
  return marks.map((mark, index) => {
    const previous = index > 0 ? marks[index - 1] : undefined;
    return {
      phase: mark.phase,
      atMs: mark.atMs,
      sincePrevMs: previous ? mark.atMs - previous.atMs : null,
    };
  });
}

// One compact line, e.g.
// "startup:bootstrap-begin 0ms | startup:modules-loaded 212ms(+212ms) | ..."
export function formatStartupTimingSummary(): string {
  return getStartupPhaseRecords()
    .map((record) => {
      const at = `${record.phase} ${Math.round(record.atMs)}ms`;
      return record.sincePrevMs === null ? at : `${at}(+${Math.round(record.sincePrevMs)}ms)`;
    })
    .join(" | ");
}

// Appends the summary when it can land: nothing is written while debug logging
// is off (marks stay buffered for a later flush), and a summary is appended
// only when it covers marks not yet flushed, so repeated triggers (first frame,
// end of the init chain, enabling debug logging) never duplicate it. The
// summary always covers all marks so far, so the last entry in the log is the
// complete one.
export function flushStartupMarks() {
  if (flushedMarkCount === marks.length) return;
  if (!isDebugLoggingEnabled()) return;
  flushedMarkCount = marks.length;
  appendDebugLog("info", "[DBX][startup-timing]", formatStartupTimingSummary());
}

// Boot collected its marks before the user switched debug logging on (it is off
// by default): flush the buffered summary the moment it becomes reachable.
onDebugLoggingEnabled(() => flushStartupMarks());
