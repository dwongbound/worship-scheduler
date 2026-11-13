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
      // The class is what sizes it on screen, but these are what next/image
      // builds its srcset from. Left to the import's intrinsic 3000px, the
      // srcset was one 3840w variant: every page asked the optimizer to
      // encode the full master for a 36px box (39 KB where ~4 KB does), and
      // in CI that encode stalled the page's load event outright. 96 covers
      // the largest use (h-12 = 48px) at 2x; next/image adds a 2x of its own.
      width={96}
      height={96}
      // `priority` because this is in the navbar on every page, and
      // lazy-loading it flashes an empty box.
      priority
      className={className}
    />
  );
}
