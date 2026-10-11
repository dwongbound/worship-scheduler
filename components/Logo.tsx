import Image from "next/image";
import logo from "@/assets/tw-logo-master.png";

// The TapWorship mark: a blackletter "tw" in a black disc.
//
// A raster, not vector paths. It used to be hand-drawn SVG so it needed no
// asset and scaled freely; it's now the real artwork, which has weight and
// detail no inline path was going to reproduce.
//
// Imported straight from the 3000px master, which is the repo's only copy of
// the mark — next/image resizes it and serves a variant that fits, so the
// full-size file never reaches a browser. A committed 256px copy would just
// be a fourth thing to re-export whenever the artwork changes.
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
