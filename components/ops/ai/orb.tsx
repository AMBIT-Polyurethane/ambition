// AMBIT Intelligence's face: the AMBIT atom, alive. The white and red halves turn against each other
// inside a glow that mixes AMBIT red with the contractor's colors (--b, --b2), so it reads as AMBIT and
// as theirs at the same time. Moods: idle (slow, breathing), listening (rings ripple out, the atom swells
// with the voice level --lvl), thinking (spins fast), speaking (pulses). Styles: "AMBIT Intelligence" in
// app/globals.css. Pure markup, so it works anywhere; motion stops for people who ask for less motion.

export type OrbMood = "idle" | "listening" | "thinking" | "speaking";

export function AtomOrb({ size = 44, mood = "idle", core = false, className = "", level }: { size?: number; mood?: OrbMood; core?: boolean; className?: string; level?: number }) {
  const style = { "--orb": `${size}px`, ...(level !== undefined ? { "--lvl": Math.max(0, Math.min(1, level)).toFixed(3) } : {}) } as React.CSSProperties;
  return (
    <span className={`aorb ${mood}${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <span className="aorb-halo" />
      <span className="aorb-ripple" />
      <span className="aorb-ripple two" />
      <span className="aorb-disc" />
      <span className="aorb-atom">
        <img className="aorb-w" src="/splash/atom-white.svg" alt="" draggable={false} />
        <img className="aorb-r" src="/splash/atom-red.svg" alt="" draggable={false} />
        {core ? <img className="aorb-c" src="/splash/atom-core.svg" alt="" draggable={false} /> : null}
      </span>
    </span>
  );
}
