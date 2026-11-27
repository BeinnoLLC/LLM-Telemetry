// T-23 RUN B: one canonical reader for the Python drawer/modal and their Next
// counterparts. Parity compares rendered text and state, not tag names; the
// Python drawer's "no session ids" note is a div while Next's is a button.
import type { Page } from "playwright";

export interface DrawerDom {
  hidden: string | null;
  open: boolean;
  visibility: string;
  scrimOpen: boolean;
  title: string;
  sections: string[];
  recent: Array<{ tag: string; text: string }>;
}

export interface TranscriptOpener {
  id: string;
  profile: string;
  text: string;
}

export interface ModalMessageDom {
  role: string;
  text: string;
}

export interface ModalEmptyDom {
  icon: string;
  message: string;
  hint: string;
}

export interface ModalDom {
  hidden: string | null;
  open: boolean;
  scrimOpen: boolean;
  title: string;
  sub: string;
  messages: ModalMessageDom[];
  empty: ModalEmptyDom | null;
  timelinePresent: boolean;
}

/** Re-arm the first recent-session row on either side with the same real
 * session id/text from the frozen artifacts. The Python drawer emits plain
 * divs, so its oracle row needs the transcript data attributes; the Next row
 * is shipped already and must keep its own profile from the loaded artifact.
 * Asserting that shipped attribute is the point of the parity case — never
 * overwrite it here. */
export async function armTranscriptOpener(
  page: Page,
  opener: TranscriptOpener,
  side: "python" | "next",
): Promise<void> {
  await page.evaluate(
    ({ value, source }) => {
      const row = document.querySelector<HTMLElement>(
        "#pdbody .pdsessrow, #pdbody .ttitlebtn, #pdbody .pdsection:last-child > .muted",
      );
      if (!row) throw new Error("no drawer session opener");
      if (source === "next") {
        const shipped = row.getAttribute("data-tprofile");
        if (shipped) throw new Error(`Next opener profile was rewritten: ${shipped}`);
      } else {
        row.setAttribute("data-tprofile", value.profile);
      }
      row.classList.add("ttitlebtn");
      row.textContent = value.text;
      row.setAttribute("data-tsession", value.id);
      row.tabIndex = 0;
    },
    { value: opener, source: side },
  );
}

export async function readDrawerDom(page: Page): Promise<DrawerDom> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    // Python's provLogoSvg emits a two-letter monogram for providers without a
    // brand path; RUN B never does. Drop only those short styled spans — the
    // same documented exception the matrix parity reader uses — before text
    // comparison, while keeping the rest of the drawer text verbatim.
    const text = (element: Element | null | undefined): string => {
      const clone = element?.cloneNode(true) as HTMLElement | null | undefined;
      clone?.querySelectorAll<HTMLElement>("span").forEach((span) => {
        if (span.style.fontSize && clean(span.textContent).length <= 2) span.remove();
      });
      return clean(clone?.textContent);
    };
    const drawer = document.querySelector("#pdrawer");
    const scrim = document.querySelector("#pdscrim");
    return {
      hidden: drawer?.getAttribute("aria-hidden") ?? null,
      open: drawer?.classList.contains("open") ?? false,
      visibility: drawer ? getComputedStyle(drawer).visibility : "",
      scrimOpen: scrim?.classList.contains("open") ?? false,
      title: text(drawer?.querySelector("#pdtitle")),
      // Python's template leaves whitespace between adjacent spans; React does
      // not. Compare the same words without layout whitespace.
      sections: [...(drawer?.querySelectorAll("#pdbody .pdsection") ?? [])].map((node) =>
        text(node).replace(/\s/g, ""),
      ),
      recent: [
        ...(drawer?.querySelectorAll(
          "#pdbody .pdsessrow, #pdbody .pdsection:last-child > .muted",
        ) ?? []),
      ].map((node) => ({ tag: node.tagName, text: text(node).replace(/\s/g, "") })),
    };
  });
}

export async function readModalDom(page: Page): Promise<ModalDom> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();
    const text = (element: Element | null | undefined): string =>
      clean(element?.textContent);
    const modal = document.querySelector("#tmodal");
    const scrim = document.querySelector("#tscrim");
    const body = modal?.querySelector("#tbody");
    const empty = body?.querySelector(".empty");
    return {
      hidden: modal?.getAttribute("aria-hidden") ?? null,
      open: modal?.classList.contains("open") ?? false,
      scrimOpen: scrim?.classList.contains("open") ?? false,
      title: text(modal?.querySelector("#ttitle")),
      sub: text(modal?.querySelector("#tsub")),
      messages: [...(body?.querySelectorAll(".tmsg") ?? [])].map((node) => ({
        role: [...node.classList].find((name) => name.startsWith("role-")) ?? "",
        text: text(node),
      })),
      empty: empty
        ? {
            icon: text(empty.querySelector(".e-ico")),
            message: text(empty.querySelector(".e-msg")),
            hint: text(empty.querySelector(".e-hint")),
          }
        : null,
      timelinePresent: Boolean(modal?.querySelector("#ttimelinebtn")),
    };
  });
}
