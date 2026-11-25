"use client";

// T-23 RUN B: the recent-session row used by the project drawer. Python emits
// a div for the "no session ids" note and a button otherwise; the chip keeps
// one .ttitlebtn surface so parity can compare text and the harness can re-arm
// data-tsession/data-tprofile on either side.
import type { MouseEvent, ReactNode } from "react";

export interface SessionIndexChipProps {
  sessionId: string;
  profile: string;
  children: ReactNode;
  muted?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export default function SessionIndexChip({
  sessionId,
  profile,
  children,
  muted = false,
  onClick,
}: SessionIndexChipProps) {
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
