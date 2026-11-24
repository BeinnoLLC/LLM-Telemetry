// T-20: small client marker so NavRail can stay a server component while the
// active link still carries a real aria-current attribute after navigation.
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function NavActive() {
  const pathname = usePathname();

  useEffect(() => {
    document.querySelectorAll<HTMLAnchorElement>("[data-nav-path]").forEach((link) => {
      if (link.dataset.navPath === pathname) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }, [pathname]);

  return null;
}
