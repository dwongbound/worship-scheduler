import Image from "next/image";
import logo from "@/public/tw-logo.png";

// The TapWorship mark: a blackletter "tw" in a black disc.
//
// A raster, not vector paths. It used to be hand-drawn SVG so it needed no
// asset and scaled freely; it's now the real artwork, which has weight and
// detail no inline path was going to reproduce. The committed file is 256px —
// the largest this is ever drawn at is the navbar's 36px, so 256 covers a 3×
// display with room to spare, and `assets/tw-logo-master.png` keeps the 3000px
// original for regenerating the icons.
//
// Transparent around the disc, so it sits on either theme unchanged.

export default function Logo({
  className = "h-9 w-9",
  title = "TapWorship",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <Image
      src={logo}
      alt={title}
      // Intrinsic size comes from the import; the class is what actually sizes
      // it, so `priority` matters more than dimensions here — this is in the
      // navbar on every page, and lazy-loading it flashes an empty box.
      priority
      className={className}
    />
  );
}
