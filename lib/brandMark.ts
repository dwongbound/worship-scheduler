import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The one image in the repo, and how the icon routes read it.
//
// `assets/tw-logo-master.png` is the ONLY committed copy of the mark. Every
// size the app serves is derived from it at build time — the favicon and the
// iOS icon by the two generators in app/, and the Navbar's by next/image from
// a static import. Committing pre-resized copies instead would mean four
// files that must be re-exported together and silently disagree when they
// aren't.
//
// Not in public/: public/ is served verbatim, and nothing should be able to
// fetch a 3000px PNG. It's a build input.
export const BRAND_MARK_PATH = "assets/tw-logo-master.png";

/**
 * The mark as a data URI, for `next/og`'s ImageResponse.
 *
 * Satori can't take a filesystem path — it wants a URL or a data URI, and a
 * relative URL has no origin to resolve against while the build is generating
 * these. Read at build time, so the cost is paid once and never per request.
 */
export async function brandMarkDataUri(): Promise<string> {
  const png = await readFile(join(process.cwd(), BRAND_MARK_PATH));
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * The disc's own colour, sampled from the master.
 *
 * Only the iOS icon needs it: Apple composites any transparency onto black,
 * so a transparent home-screen icon keeps the white "tw" and loses the disc
 * around it. Filling with the disc's colour makes that square the mark.
 */
export const BRAND_MARK_BG = "#121212";
