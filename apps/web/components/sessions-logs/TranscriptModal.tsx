"use client";

// T-23 RUN B: transcript modal, ported from drawer.js:455-560. The payload is
// fetched on demand once per (profile, id); the Python modal is the DOM oracle.
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { loadTranscript } from "../../lib/sessions-logs/load";
import { emptyHTML, renderTranscript } from "../../lib/sessions-logs/transcript";
import useOverlayFocus from "../../lib/sessions-logs/use-overlay-focus";

type Status = "idle" | "loading" | "ready" | "empty" | "error";

export interface TranscriptSession {
  id: string;
  profile: string;
  title: string;
}

export interface TranscriptModalProps {
  session: TranscriptSession | null;
  onClose: () => void;
}

export default function TranscriptModal({ session, onClose }: TranscriptModalProps) {
  const modalRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<unknown[]>([]);
  const [error, setError] = useState("");

  const sessionId = session?.id ?? "";
  const profile = session?.profile ?? "";
  const open = session !== null;

  useEffect(() => {
    if (!sessionId) {
      setStatus("idle");
      setMessages([]);
      setError("");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    setMessages([]);
    setError("");
    loadTranscript(profile, sessionId, Date.now())
      .then((values) => {
        if (cancelled) return;
        setMessages(values);
        setStatus(values.length ? "ready" : "empty");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, profile]);

  useOverlayFocus({ open, modalRef, scrimRef, bodyRef, onClose });

  const transcriptHtml = useMemo(() => renderTranscript(messages), [messages]);
  const bodyHtml =
    status === "ready"
      ? transcriptHtml
      : status === "empty"
        ? emptyHTML(
            "○",
            "No recent messages captured for this session yet.",
            "The transcript window refreshes with the collector cycle.",
          )
        : status === "error"
          ? emptyHTML("!", "Could not load this transcript.", error)
          : "";

  useEffect(() => {
    if (status === "ready" && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [status, transcriptHtml]);

  /** Python's inline onerror becomes capture-phase delegation: only a real
   * data:image failure is turned into the `<broken image>` placeholder. */
  const handleImageError = (event: SyntheticEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.classList.contains("timg")) return;
    target.classList.add("tbroken");
    if (target.nextElementSibling?.textContent === "<broken image>") return;
    const note = document.createElement("span");
    note.textContent = "<broken image>";
    target.insertAdjacentElement("afterend", note);
  };

  const sub =
    status === "loading"
      ? "loading…"
      : status === "ready"
        ? `${messages.length} messages · most recent tail`
        : "";

  return (
    <>
      <div
        id="tscrim"
        ref={scrimRef}
        className={`scrim t-scrim${open ? " open" : ""}`}
        aria-hidden={!open}
        onClick={open ? onClose : undefined}
      />
      <section
        id="tmodal"
        ref={modalRef}
        className={`modal modal-md t-modal${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Session transcript"
        aria-hidden={!open}
      >
        <div className="thead">
          <b id="ttitle" className="t-title">
            {session?.title || sessionId}
          </b>
          <span id="tsub" className="t-sub muted">
            {sub}
          </span>
          {/*
           * #lnmodal (T-22) owns the real timeline panel, which is out of scope
           * for T-23. The button stays present and inert here for visual/text
           * parity with dashboard.html:867; do not wire it in this change.
           */}
          <button
            id="ttimelinebtn"
            type="button"
            className="chip lntimelinebtn"
            title="View this session's timeline"
            data-tsession={sessionId}
            data-tprofile={profile}
            data-title={session?.title || sessionId}
            tabIndex={open ? 0 : -1}
          >
            Timeline
          </button>
          <button
            id="tclose"
            type="button"
            className="chip"
            aria-label="Close transcript"
            title="Close (Esc)"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div
          id="tbody"
          ref={bodyRef}
          tabIndex={-1}
          onErrorCapture={handleImageError}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </section>
    </>
  );
}
