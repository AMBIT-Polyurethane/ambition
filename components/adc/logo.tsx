/** The ADC Monoline logo: A with a red dot, D, and a red C. Drawn in code so it's sharp everywhere. */
export function AdcLogo({ width = 84, ink = "#F5F5F7", title = "ADC" }: { width?: number; ink?: string; title?: string }) {
  const h = Math.round((width * 112) / 264);
  return (
    <svg role="img" aria-label={title} width={width} height={h} viewBox="-6 -6 264 112">
      <polyline points="8,92 38,8 68,92" fill="none" stroke={ink} strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="38" cy="68" r="7.5" fill="#E33527" />
      <path d="M86 8 V92 H112 A42 42 0 0 0 112 8 Z" fill="none" stroke={ink} strokeWidth="12" strokeLinejoin="round" />
      <path d="M242 22 A40 40 0 1 0 242 78" fill="none" stroke="#E33527" strokeWidth="12" strokeLinecap="round" />
    </svg>
  );
}
