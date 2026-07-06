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
    if (visible) setRendered(true);
  }, [visible]);

  return (
    <LoadingContext.Provider value={{ begin, report }}>
      {children}
      {rendered && (
        <div
          aria-hidden={!visible}
          onTransitionEnd={() => {
            if (!visible) setRendered(false);
          }}
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
