"use client";

// T-23 RUN B: one focus-trap/restore hook shared by the project drawer and the
// transcript modal. Mirrors js/drawer.js trapFocus/trapTab (T-20 primitives).
import { useCallback, useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = "a[href],button,[tabindex]";

export interface OverlayFocusOptions {
  open: boolean;
  modalRef: RefObject<HTMLElement | null>;
  scrimRef: RefObject<HTMLElement | null>;
  bodyRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export default function useOverlayFocus({
  open,
  modalRef,
  scrimRef,
  bodyRef,
  onClose,
}: OverlayFocusOptions): void {
  const openerRef = useRef<HTMLElement | null>(null);
  const releasedRef = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const release = useCallback(() => {
    if (releasedRef.current) return;
    releasedRef.current = true;
    modalRef.current?.setAttribute("aria-hidden", "true");
    scrimRef.current?.setAttribute("aria-hidden", "true");
    openerRef.current?.focus();
    openerRef.current = null;
  }, [modalRef, scrimRef]);

  useEffect(() => {
    if (!open) {
      release();
      return undefined;
    }
    const modal = modalRef.current;
    const scrim = scrimRef.current;
    if (!modal || !scrim) return undefined;

    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    releasedRef.current = false;
    modal.setAttribute("aria-hidden", "false");
    scrim.setAttribute("aria-hidden", "false");
    bodyRef?.current?.focus();

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        bodyRef?.current?.focus();
        return;
      }
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && focusables.includes(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => {
      document.removeEventListener("keydown", onKeydown, true);
      release();
    };
  }, [open, modalRef, scrimRef, bodyRef, release]);
}
