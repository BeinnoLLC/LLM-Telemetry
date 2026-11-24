// Server component: the grouped view links mirror router.js NAV_GROUPS.
import Link from "next/link";
import { NAV_GROUPS, pathForView } from "@/lib/nav";
import NavActive from "./NavActive";

export default function NavRail() {
  return (
    <nav className="nav-rail" aria-label="Views">
      {NAV_GROUPS.map((group) => (
        <div className="nav-group" key={group.name}>
          <h2 className="nav-group-title">{group.name}</h2>
          <ul className="nav-list">
            {group.views.map((view) => {
              const href = pathForView(view);
              return (
                <li key={view}>
                  <Link className="nav-link" data-nav-path={href} href={href}>
                    {view}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {/* Adds aria-current=page to the link matching the live pathname. */}
      <NavActive />
    </nav>
  );
}
