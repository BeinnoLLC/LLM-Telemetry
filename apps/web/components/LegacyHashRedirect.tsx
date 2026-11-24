// T-20: consume a legacy `#/slug` bookmark once, then leave the URL alone.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { legacyHashToPath } from "@/lib/nav";

export default function LegacyHashRedirect() {
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    const target = legacyHashToPath(window.location.hash);
    if (!target) return;
    redirected.current = true;
    router.replace(target, { scroll: false });
  }, [router]);

  return null;
}
