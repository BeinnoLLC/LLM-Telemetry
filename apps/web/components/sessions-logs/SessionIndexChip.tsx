"use client";

// T-23 RUN B: the recent-session row used by the project drawer. Python emits
// a div for the "no session ids" note and a button otherwise; the chip keeps
// one .ttitlebtn surface for real sessions so parity can compare text and the
// harness can re-arm data-tsession/data-tprofile on either side. A note row
// has no session id and must stay a non-focusable div, never an empty button.
import type { MouseEvent, ReactNode } from "react";

export interface SessionIndexChipProps {
  sessionId: string;
  profile: string;
  children: ReactNode;
  muted?: boolean;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

export default function SessionIndexChip({
  sessionId,
  profile,
  children,
  muted = false,
  onClick,
}: SessionIndexChipProps) {
  if (!sessionId) {
    // No individual session: mirror the Python div. The harness may still
    // re-arm this row with a real id, so keep the same click surface.
    return (
      <div
        className={`pdsessrow${muted ? " sm-muted" : ""}`}
        onClick={onClick}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`ttitlebtn pdsessrow${muted ? " sm-muted" : ""}`}
      data-tsession={sessionId}
      data-tprofile={profile}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
