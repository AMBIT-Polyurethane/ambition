type Art = "logo" | "atom-mark" | "academy-mark";

/** AMBIT artwork: the white-ink file in dark mode, the black-ink file in light mode. */
export function BrandImg({
  art,
  alt = "",
  ...rest
}: { art: Art; alt?: string } & Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "className">) {
  const dark = art === "logo" ? "/brand/logo-white.png" : `/brand/${art}.png`;
  return (
    <>
      <img src={dark} alt={alt} className="on-dark" {...rest} />
      <img src={`/brand/${art}-dark.png`} alt={alt} className="on-light" {...rest} />
    </>
  );
}
