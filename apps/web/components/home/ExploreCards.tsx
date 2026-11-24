// LLMTELEMET-291 (T-20 RUN C2): the Explore strip. Every headline value is the
// one already derived by exploreCards() from the same date-scoped rows.
import { exploreCards } from "../../lib/home/kpis";
import type {
  AnalyticsProfile,
  NumLike,
  QuotaData,
  RouterData,
} from "../../lib/home/types";

export interface ExploreCardsProps {
  profile: AnalyticsProfile | null | undefined;
  name: string;
  router?: RouterData | null;
  quota?: QuotaData | null;
  tariff?: NumLike;
}

export default function ExploreCards({
  profile,
  name,
  router,
  quota,
  tariff = null,
}: ExploreCardsProps) {
  const cards = exploreCards(profile, name, undefined, router, quota, tariff);
  return (
    <section id="homecards" className="explore-grid" aria-label="Explore">
      {cards.map((card) => (
        <a
          key={card.title}
          className="card homecard xcard"
          href={`/${card.href}`}
          data-sec={card.sec}
          title={card.blurb}
        >
          <span className="xp-row">
            <span className="xp-title">{card.title}</span>
            <span className="hc-stat">{card.value}</span>
          </span>
          <span className="xp-blurb">{card.blurb}</span>
        </a>
      ))}
    </section>
  );
}
