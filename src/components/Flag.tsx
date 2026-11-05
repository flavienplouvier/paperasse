import type { FlagId } from "../lib/language";

/**
 * Drapeaux dessinés en SVG : les émojis drapeaux ne s'affichent pas sous
 * Windows (deux lettres à la place).
 */
const FLAGS: Record<FlagId, React.ReactNode> = {
  fr: (
    <>
      <rect width="10" height="20" fill="#002395" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ed2939" />
    </>
  ),
  it: (
    <>
      <rect width="10" height="20" fill="#009246" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ce2b37" />
    </>
  ),
  de: (
    <>
      <rect width="30" height="7" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#dd0000" />
      <rect y="13.33" width="30" height="6.67" fill="#ffce00" />
    </>
  ),
  nl: (
    <>
      <rect width="30" height="7" fill="#ae1c28" />
      <rect y="6.67" width="30" height="6.67" fill="#fff" />
      <rect y="13.33" width="30" height="6.67" fill="#21468b" />
    </>
  ),
  es: (
    <>
      <rect width="30" height="20" fill="#aa151b" />
      <rect y="5" width="30" height="10" fill="#f1bf00" />
    </>
  ),
  pt: (
    <>
      <rect width="30" height="20" fill="#ff0000" />
      <rect width="12" height="20" fill="#006600" />
      <circle cx="12" cy="10" r="4" fill="#ffcc00" />
      <circle cx="12" cy="10" r="2.4" fill="#ff0000" />
    </>
  ),
  cn: (
    <>
      <rect width="30" height="20" fill="#de2910" />
      <path d="M5 2.2l1.2 3.6H10L7 8l1.1 3.6L5 9.4 1.9 11.6 3 8 0 5.8h3.8z" fill="#ffde00" />
      <circle cx="11" cy="2.5" r="0.9" fill="#ffde00" />
      <circle cx="13" cy="4.6" r="0.9" fill="#ffde00" />
      <circle cx="13" cy="7.5" r="0.9" fill="#ffde00" />
      <circle cx="11" cy="9.6" r="0.9" fill="#ffde00" />
    </>
  ),
  gb: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.4" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" />
    </>
  ),
  us: (
    <>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />
      ))}
      <rect width="13" height={(7 * 20) / 13} fill="#3c3b6e" />
      {[2, 5, 8, 11].flatMap((x) => [2, 5, 8].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y + (x % 2 ? 0 : 1.2)} r="0.6" fill="#fff" />))}
    </>
  ),
};

export function Flag({ id, size = 20 }: { id: FlagId; size?: number }) {
  return (
    <svg className="flag" width={size * 1.5} height={size} viewBox="0 0 30 20" aria-hidden="true">
      <clipPath id={`flag-${id}`}>
        <rect width="30" height="20" rx="2.5" />
      </clipPath>
      <g clipPath={`url(#flag-${id})`}>{FLAGS[id]}</g>
      <rect width="30" height="20" rx="2.5" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="0.8" />
    </svg>
  );
}
