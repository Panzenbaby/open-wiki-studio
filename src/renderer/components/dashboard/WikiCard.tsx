import { useAtomValue } from "jotai";
import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import { useT } from "../../i18n.ts";
import { useNavigation } from "../../navigation.ts";
import { wikiOverviewAtom } from "../../store.ts";
import { pluralKey } from "../../../shared/i18n.ts";
import { IconTile } from "./IconTile.tsx";

/** Wiki size and review progress; the whole card opens the wiki. */
export function WikiCard(): JSX.Element {
  const t = useT();
  const overview = useAtomValue(wikiOverviewAtom);
  const { showBrowser } = useNavigation();
  const unverified = overview.concepts - overview.verified;
  const verifiedPercent = overview.concepts > 0 ? (overview.verified / overview.concepts) * 100 : 0;
  const counts = t("dashboard.wiki.counts", {
    concepts: t(pluralKey("dashboard.wiki.concepts", overview.concepts), { n: overview.concepts }),
    files: t(pluralKey("dashboard.wiki.files", overview.sourceFiles), { n: overview.sourceFiles }),
  });

  return (
    <button
      type="button"
      className="dash-card wiki-card"
      onClick={() => showBrowser("wiki")}
      aria-label={t("dashboard.wiki.open", { counts, verified: overview.verified })}
    >
      <span className="wiki-card-head">
        <IconTile tone="info"><BookOpen size={26} strokeWidth={1.75} /></IconTile>
        <span className="wiki-card-text">
          <span className="wiki-card-title">{t("dashboard.wiki.title")}</span>
          <span className="wiki-card-counts">{counts}</span>
        </span>
        <span className="round-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
      </span>
      {overview.concepts === 0 ? (
        <span className="dash-sub">{t("dashboard.wiki.empty")}</span>
      ) : (
        <span className="verify-summary">
          <span className="verify-bar" aria-hidden="true">
            <span style={{ width: `${verifiedPercent}%` }} />
          </span>
          <span className="verify-legend">
            <span className="is-verified">
              <ShieldCheck size={14} aria-hidden="true" />
              {t("dashboard.wiki.verified", { n: overview.verified })}
            </span>
            <span className="is-unverified">{t("dashboard.wiki.unverified", { n: unverified })}</span>
          </span>
        </span>
      )}
    </button>
  );
}
