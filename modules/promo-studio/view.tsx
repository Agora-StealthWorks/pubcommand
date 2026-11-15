import { exampleCatalog, promosInPackage, statusLabel, type Promo, type PromoScore } from "./catalog";

const STATUS_COLOR: Record<Promo["status"], { background: string; color: string }> = {
  draft: { background: "#f5f6f8", color: "#3e4a5c" },
  in_review: { background: "#fef0c7", color: "#b54708" },
  approved: { background: "#dcfae6", color: "#067647" },
  archived: { background: "#f5f6f8", color: "#3e4a5c" },
};

function pointTotal(score: PromoScore): number {
  return score.factors.reduce((sum, factor) => sum + factor.points, 0);
}

/**
 * Read-only example catalog for the organization the shell already resolved.
 * TODO(analyzer): swap the stub score for a real model.
 * TODO(assembly): attach the files a package will export.
 */
export function PromoStudioView({ organizationId }: { organizationId: string }) {
  const catalog = exampleCatalog(organizationId);

  return (
    <div data-module="promo-studio" style={{ display: "grid", gap: 24 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)" }}>
          Promo Studio
        </h1>
        <p style={{ margin: "6px 0 0", maxWidth: 640, fontSize: 14, lineHeight: 1.5, color: "var(--muted)" }}>
          Example catalog for this organization. Scores come from a stub you can read. Nothing on this page is saved.
        </p>
      </header>

      {catalog.packages.map((bundle) => {
        const members = promosInPackage(catalog, bundle.id);
        return (
          <section
            key={bundle.id}
            style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)", padding: 16 }}
          >
            <p style={kicker}>Package</p>
            <h2 style={sectionTitle}>{bundle.name}</h2>
            <p style={{ margin: "4px 0 12px", fontSize: 13, color: "var(--muted)" }}>
              Groups {members.length} promos. File assembly is not built yet.
            </p>
            <ul style={plainList}>
              {members.map((promo) => (
                <li key={promo.id} style={packageRow}>
                  <span>{promo.name}</span>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    {statusLabel(promo.status)} · {promo.score.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={sectionTitle}>Catalog</h2>
        {catalog.promos.map((promo) => {
          const raw = pointTotal(promo.score);
          return (
            <article
              key={promo.id}
              style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)", padding: 16 }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <h3 style={{ margin: 0, minWidth: 0, fontSize: 16, fontWeight: 600, color: "var(--ink)", overflowWrap: "anywhere" }}>{promo.name}</h3>
                <span style={{ ...pill, ...STATUS_COLOR[promo.status] }}>{statusLabel(promo.status)}</span>
              </div>
              <p style={{ margin: "10px 0 6px", fontSize: 14, color: "var(--ink)" }}>
                Score <strong>{promo.score.value}</strong>
                <span style={{ color: "var(--muted)" }}> / 100</span>
              </p>
              <div
                aria-hidden
                style={{ height: 8, borderRadius: 999, background: "var(--bg)", overflow: "hidden" }}
              >
                <div style={{ width: `${promo.score.value}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              {raw > promo.score.value ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  Factor points sum to {raw}. The score is capped at 100.
                </p>
              ) : null}
              <ul style={{ ...plainList, marginTop: 12, gap: 6 }}>
                {promo.score.factors.map((factor) => (
                  <li key={factor.code} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink)" }}>
                    <strong>{factor.label}</strong> +{factor.points}. {factor.reason}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </section>
    </div>
  );
}

const kicker = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--muted)",
} as const;

const sectionTitle = {
  margin: "4px 0 0",
  fontSize: 18,
  fontWeight: 600,
  color: "var(--ink)",
} as const;

const plainList = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
} as const;

const packageRow = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 0",
  borderTop: "1px solid var(--line)",
  fontSize: 14,
  minWidth: 0,
  overflowWrap: "anywhere",
} as const;

const pill = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
} as const;
