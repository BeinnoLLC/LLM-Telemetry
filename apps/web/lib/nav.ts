// T-20 (LLMTELEMET-291): the legacy hash router's view list, regrouped by
// LLMTELEMET-277, as typed data shared by the shell and the route stubs.

export const NAV_GROUPS = [
  { name: "Live", views: ["Home", "Life", "Flow", "Hive"] },
  { name: "Usage & Costs", views: ["Usage", "Cost", "Prices", "Sessions"] },
  { name: "Models & Providers", views: ["Router", "Rankings", "Quota", "Health"] },
  { name: "Tasks & Queue", views: ["Kanban", "Orchestration"] },
  { name: "System", views: ["Detail", "Logs", "Settings"] },
] as const;

export type ViewName = (typeof NAV_GROUPS)[number]["views"][number];

export const ALL_VIEWS: readonly ViewName[] = NAV_GROUPS.flatMap(
  (group) => group.views,
);

// router.js VIEW_ALIASES: #/live is a bookmark for Home, not a Live view.
export const VIEW_ALIASES: Readonly<Record<string, ViewName>> = {
  live: "Home",
};

export function pathForView(view: ViewName): string {
  return view === "Home" ? "/" : `/${view.toLowerCase()}`;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function findView(slug: string): ViewName | null {
  const key = decodeSafely(slug).trim().replace(/^#\/?/, "").toLowerCase();
  return VIEW_ALIASES[key] ?? ALL_VIEWS.find((view) => view.toLowerCase() === key) ?? null;
}

// Slug -> path. Unknown slugs go Home so a stale bookmark never blanks the app.
export function resolveSlug(slug: string): string {
  const view = findView(slug);
  return view ? pathForView(view) : "/";
}

// One-way bridge for legacy `#/slug?query` URLs. Returns null for hashes that
// were never view routes, so the redirect client does not touch other anchors.
export function legacyHashToPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const body = hash.slice(2);
  const queryAt = body.indexOf("?");
  const slug = queryAt === -1 ? body : body.slice(0, queryAt);
  const query = queryAt === -1 ? "" : body.slice(queryAt);
  return resolveSlug(slug) + query;
}
