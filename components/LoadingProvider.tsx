"use client";
// One shared full-page loader for the whole app, so there's never more than
// one loader on screen (no flicker). Two things drive it:
//   • begin()          — called the instant a nav tab is clicked, so the
//                        loader appears immediately, before the next page
//                        has even mounted.
//   • usePageLoading() — each page reports its own data-loading state; when
//                        it flips to false the overlay fades out, revealing
//                        the page underneath.
// The overlay is z-20, below the sticky navbar (z-30), so the nav stays put.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import LoadingScreen from "./common/LoadingScreen";

type Controls = { begin: () => void; report: (loading: boolean) => void };

/** The overlay's fade-out, and how long it stays mounted for it. Keep in step
 *  with the `duration-300` class below. */
const FADE_MS = 300;

const LoadingContext = createContext<Controls>({
  begin: () => {},
  report: () => {},
});

/** Returns begin(): show the loader immediately on a navigation click. */
export function useBeginNavigation() {
  return useContext(LoadingContext).begin;
}

/** Drive the shared overlay from a page's own loading flag. */
export function usePageLoading(loading: boolean) {
  const { report } = useContext(LoadingContext);
  useEffect(() => {
    report(loading);
    // A page that unmounts while still loading (e.g. AuthGate redirecting to
    // /join mid-fetch) must release the overlay, or it covers the next page.
    return () => report(false);
  }, [loading, report]);
}

export default function LoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // `navigating` is the instant click signal; `pageLoading` is the mounted
  // page's real state. Once a page reports, it owns visibility.
  const [navigating, setNavigating] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  // Kept true until the fade-out finishes, so the overlay can animate out.
  const [rendered, setRendered] = useState(false);

  const visible = navigating || pageLoading;

  const begin = useCallback(() => setNavigating(true), []);
  const report = useCallback((loading: boolean) => {
    setNavigating(false);
    setPageLoading(loading);
  }, []);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      return;
    }
    // Unmount on a TIMER, not on transitionend.
    //
    // `transitionend` only fires if a transition actually runs, and there are
    // ordinary cases where none does: the overlay mounted and hidden inside
    // one frame (a page whose data was already cached), or a viewer with
    // transitions off. The event then never arrives, `rendered` stays true,
    // and this `fixed inset-0` box sits over the page forever — invisible and
    // inert, so nobody notices, but permanently there. A timer always fires.
    const timer = window.setTimeout(() => setRendered(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <LoadingContext.Provider value={{ begin, report }}>
      {children}
      {rendered && (
        <div
          // e2e reads this to know the app has finished assembling: `goto`
          // resolves on `load`, which here is before the first fetch has even
          // been sent (see gotoReady in tests/e2e/helpers.ts). Which also means
          // it must really leave the DOM — hence the timer above.
          data-testid="page-loading"
          aria-hidden={!visible}
          // `duration-300` must stay in step with FADE_MS.
          className={`fixed inset-0 z-20 transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <LoadingScreen />
        </div>
      )}
    </LoadingContext.Provider>
  );
}
