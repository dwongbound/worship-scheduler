// Mirroring a modal's identity into the address bar — `?set=`, `?draft=` —
// and clearing it again.
//
// `router.replace` CANNOT do this. In Next 16 a soft navigation whose target
// pathname is the one already on screen is dropped: the address bar never
// changes, and — the half that actually broke — removing a param never
// reaches `useSearchParams`, so a modal the param opened could not be closed
// at all. That is what someone following a Google Calendar invite's link hit:
// `/calendar?set=<id>` opens the set, and Close, the ✕, Escape and the
// backdrop all ran a navigation the router threw away.
//
// The native history API is the supported way to change search params without
// a navigation (Next 14.1+), and Next keeps `useSearchParams` in step with it,
// so the derived state follows the URL exactly as it did before. It also never
// scrolls, which is what every caller here passed `scroll: false` for.
export function replaceUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", url);
}
