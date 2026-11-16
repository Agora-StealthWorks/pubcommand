/** Small preview drawings for the dashboard cards. Pure SVG, light theme. */

const A = "#3B5BDB";
const A2 = "#91A7FF";
const L = "#E4E7EC";
const G = "#12B76A";

function Frame({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 150" className="block h-auto w-full" role="presentation" aria-hidden>
      <rect width="320" height="150" fill={tint} />
      <rect x="16" y="14" width="288" height="136" rx="8" fill="#fff" stroke={L} />
      <rect x="16" y="14" width="288" height="18" rx="8" fill="#F9FAFB" />
      <circle cx="28" cy="23" r="3" fill={L} />
      <circle cx="38" cy="23" r="3" fill={L} />
      <circle cx="48" cy="23" r="3" fill={L} />
      {children}
    </svg>
  );
}

function Lines({ x, y, n, w = 90 }: { x: number; y: number; n: number; w?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x} y={y + i * 11} width={w - (i % 3) * 18} height="5" rx="2.5" fill={L} />
      ))}
    </>
  );
}

const DRAWINGS: Record<string, React.ReactNode> = {
  "promo-studio": (
    <Frame tint="#EEF2FF">
      {[0, 1, 2, 3].map((c) => (
        <g key={c}>
          <rect x={28 + c * 69} y="42" width="62" height="10" rx="3" fill={L} />
          {[0, 1].slice(0, c === 1 ? 2 : 1 + (c % 2)).map((r) => (
            <g key={r}>
              <rect x={28 + c * 69} y={58 + r * 38} width="62" height="32" rx="5" fill="#fff" stroke={c === 1 && r === 0 ? A : L} />
              <rect x={34 + c * 69} y={65 + r * 38} width="40" height="5" rx="2.5" fill="#98A2B3" />
              <rect x={34 + c * 69} y={76 + r * 38} width="26" height="7" rx="3.5" fill={c === 3 ? "#D1FADF" : "#E0E7FF"} />
            </g>
          ))}
        </g>
      ))}
    </Frame>
  ),
  editorial: (
    <Frame tint="#ECFDF3">
      {Array.from({ length: 21 }, (_, i) => {
        const x = 28 + (i % 7) * 39;
        const y = 42 + Math.floor(i / 7) * 34;
        const band = [2, 3, 4, 9, 10, 16].includes(i);
        return (
          <g key={i}>
            <rect x={x} y={y} width="35" height="30" rx="4" fill="#fff" stroke={L} />
            {band ? <rect x={x + 3} y={y + 16} width="29" height="7" rx="3" fill={i < 5 ? A2 : i < 11 ? "#FEC84B" : G} /> : null}
          </g>
        );
      })}
    </Frame>
  ),
  knowledge: (
    <Frame tint="#FDF2FA">
      {[
        [80, 90, 160, 60],
        [160, 60, 240, 85],
        [160, 60, 150, 120],
        [80, 90, 150, 120],
        [240, 85, 270, 125],
      ].map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={A2} strokeWidth="2" />
      ))}
      {[
        [80, 90, 9],
        [160, 60, 12],
        [240, 85, 9],
        [150, 120, 7],
        [270, 125, 6],
      ].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill={i === 1 ? A : "#fff"} stroke={A} strokeWidth="2" />
      ))}
      <Lines x={32} y={44} n={2} w={60} />
    </Frame>
  ),
  intel: (
    <Frame tint="#FFFAEB">
      {[0, 1, 2, 3].map((r) => (
        <g key={r}>
          <rect x="28" y={44 + r * 25} width="264" height="20" rx="4" fill="#fff" stroke={L} />
          <circle cx="40" cy={54 + r * 25} r="5" fill={r === 0 ? "#F79009" : L} />
          <rect x="52" y={51 + r * 25} width={120 - r * 12} height="6" rx="3" fill="#98A2B3" />
          <rect x="240" y={51 + r * 25} width="40" height="6" rx="3" fill={L} />
        </g>
      ))}
    </Frame>
  ),
  performance: (
    <Frame tint="#ECFDF3">
      <polyline points="32,128 70,118 105,122 140,100 175,104 210,80 245,86 288,58" fill="none" stroke={G} strokeWidth="3" />
      <polygon points="32,128 70,118 105,122 140,100 175,104 210,80 245,86 288,58 288,140 32,140" fill="#D1FADF" opacity="0.6" />
      <rect x="32" y="42" width="54" height="16" rx="8" fill="#D1FADF" />
      <rect x="40" y="48" width="38" height="5" rx="2.5" fill={G} />
    </Frame>
  ),
  charts: (
    <Frame tint="#EEF2FF">
      <rect x="32" y="40" width="150" height="9" rx="4" fill="#1A1F2B" />
      <polyline points="32,128 62,120 92,124 122,104 152,108 182,86 212,90 242,70 288,62" fill="none" stroke={A} strokeWidth="3" />
      <path d="M236 52 q 18 -6 22 14" fill="none" stroke="#F04438" strokeWidth="2.5" />
      <polygon points="254,64 262,66 258,72" fill="#F04438" />
      <rect x="196" y="40" width="58" height="14" rx="4" fill="#FEE4E2" />
    </Frame>
  ),
  forms: (
    <Frame tint="#F4F3FF">
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="60" y={42 + r * 30} width="70" height="5" rx="2.5" fill="#98A2B3" />
          <rect x="60" y={51 + r * 30} width="200" height="14" rx="4" fill="#fff" stroke={L} />
        </g>
      ))}
      <rect x="60" y="132" width="60" height="12" rx="4" fill={A} />
    </Frame>
  ),
};

export function AppThumbnail({ moduleId }: { moduleId: string }) {
  return <>{DRAWINGS[moduleId] ?? <Frame tint="#F2F4F7">{null}</Frame>}</>;
}
