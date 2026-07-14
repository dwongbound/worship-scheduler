"use client";
// Guided tour: a "?" help button next to the theme toggle that runs a
// spotlight walkthrough of the app. Each step can highlight a real element
// (via its `data-tour` attribute) and navigate to the tab it's describing, so
// the tour drives the actual UI rather than just talking about it.
//
// It auto-opens once per browser (a `seen` flag in localStorage) and reopens
// whenever the button is clicked. Admins get extra steps for the admin tabs.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Button from "./common/Button";

const SEEN_KEY = "guided-tour-seen";
const TIP_WIDTH = 320;

type Step = {
  title: string;
  body: string;
  // `data-tour` value of the element to spotlight (omit for a centered card).
  target?: string;
  // Route to navigate to when this step is shown (omit to stay put).
  href?: string;
  // Skip this step below the `lg` breakpoint (e.g. the calendar, which is
  // desktop-only — a phone never renders it, so there's nothing to point at).
  desktopOnly?: boolean;
};

// Steps everyone sees. Kept in-file so the whole feature is one unit.
const COMMON_STEPS: Step[] = [
  {
    title: "Welcome to Worship Scheduler",
    body: "Plan worship teams, request set swaps, and track availability all in one place. Here's a quick tour of where things live.",
  },
  {
    title: "Calendar",
    body: "The Calendar tab shows every upcoming set. Click a set to see who's playing which role and to confirm your spot.",
    target: "/calendar",
    href: "/calendar",
  },
  {
    title: "Set Manager",
    body: "Under Sets you can request a swap when you can't make a set, and pick up sets other people have opened for cover.",
    target: "/swaps",
    href: "/swaps",
  },
  {
    title: "Availabilities",
    body: "When an admin sends an availability request, fill it in here so the scheduler knows when you can (and can't) play.",
    target: "/schedule",
    href: "/schedule",
  },
  {
    title: "Specific vs. recurring blocks",
    body: "Block out times you can't serve here. A specific block is a one-off date (e.g. away this Sunday); a recurring block repeats every week (e.g. never Thursday nights). The scheduler skips you during both.",
    target: "avail-editors",
    href: "/schedule",
  },
  {
    title: "Drag to block dates",
    body: "The fastest way to add an outage: click a day, or click and drag across a run of days on the calendar, to block them all at once.",
    target: "avail-calendar",
    href: "/schedule",
    desktopOnly: true,
  },
  {
    title: "Switching orgs",
    body: "If you serve in more than one ministry — say your college group and TapWorship — each is its own org with its own Slack workspace. Use this switcher to move between them; your calendar, sets, and requests all follow the org you pick.",
    target: "orgs",
  },
];

// Extra steps shown only to admins, covering the admin-only tabs.
const ADMIN_STEPS: Step[] = [
  {
    title: "Create sets & schedules",
    body: "The Create tab is where you add sets, roll out weekly templates, auto-generate a roster, and send availability requests.",
    target: "/create",
    href: "/create",
  },
  {
    title: "Manage your team",
    body: "Under Team you can add members, grant or revoke admin, set the instruments people play, and organize ministry teams.",
    target: "/users",
    href: "/users",
  },
];

// Closing step everyone sees last — highlights the user menu.
const PROFILE_STEP: Step = {
  title: "Your profile",
  body: "Open the menu under your name to set the instruments and roles you play — you can't be scheduled until you do. Reopen this tour anytime from the ? button.",
  target: "profile",
};

export default function GuidedTour({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Screen position of the highlighted element (null = centered card).
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Resolved top-left of the tooltip card (null until measured this frame).
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // Whether we're at the `lg` breakpoint — gates desktop-only steps so the
  // tour never points at the calendar on a phone (where it isn't rendered).
  const [isDesktop, setIsDesktop] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Admins see the admin tabs, so their tour explains them too. Drop
  // desktop-only steps when the screen can't show what they point at.
  const steps: Step[] = [
    ...COMMON_STEPS,
    ...(isAdmin ? ADMIN_STEPS : []),
    PROFILE_STEP,
  ].filter((s) => isDesktop || !s.desktopOnly);

  // If the list shrinks (e.g. a resize drops a desktop-only step) while we're
  // past the new end, snap back to the last valid step.
  useEffect(() => {
    if (step > steps.length - 1) setStep(steps.length - 1);
  }, [step, steps.length]);

  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = step === steps.length - 1;

  // Auto-open the first time this browser sees the app.
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) {
        setStep(0);
        setOpen(true);
      }
    } catch {
      // localStorage unavailable (private mode) — just skip the auto-open.
    }
  }, []);

  // Navigate to the page the current step is describing.
  useEffect(() => {
    if (!open) return;
    if (current.href && pathname !== current.href) {
      router.push(current.href);
    }
  }, [open, current.href, pathname, router]);

  // Locate + measure the element this step highlights. Elements that are
  // hidden (e.g. the desktop tab strip on a phone) measure as 0×0 — treat
  // those as "no target" so the card just centers instead.
  const measure = useCallback(() => {
    if (!open || !current.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(
      `[data-tour="${current.target}"]`,
    );
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect(r.width === 0 && r.height === 0 ? null : r);
  }, [open, current.target]);

  // Re-measure while open: on step/route change, on resize/scroll, and for a
  // handful of frames afterward so we catch the element once navigation settles.
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    let tries = 0;
    const loop = () => {
      measure();
      if (tries++ < 12) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, pathname, measure]);

  // Escape closes the tour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mark seen and close, whether the user finished or skipped.
  const finish = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore — worst case the tour auto-opens again next visit.
    }
    setOpen(false);
  };

  const openTour = () => {
    setStep(0);
    setTipPos(null);
    setOpen(true);
  };

  // Position the tooltip card each time the target moves. We measure the
  // card's real height so it can be kept fully on-screen even when the
  // highlighted element is taller than the viewport (e.g. the editors column):
  // prefer below the target, then above, then just clamp within the viewport.
  // Runs in a layout effect (before paint) so there's no visible jump.
  useLayoutEffect(() => {
    if (!open) return;
    const card = tipRef.current;
    if (!card) return;
    const M = 12; // viewport margin
    const h = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(v, max));

    if (!rect) {
      setTipPos({ top: (vh - h) / 2, left: (vw - TIP_WIDTH) / 2 });
      return;
    }
    const left = clamp(rect.left, M, vw - TIP_WIDTH - M);
    let top: number;
    if (rect.bottom + M + h <= vh - M) {
      top = rect.bottom + M; // fits below
    } else if (rect.top - M - h >= M) {
      top = rect.top - M - h; // fits above
    } else {
      top = clamp(rect.top, M, vh - h - M); // pinned on-screen next to target
    }
    setTipPos({ top: clamp(top, M, vh - h - M), left });
  }, [open, step, rect]);

  return (
    <>
      <button
        onClick={openTour}
        aria-label="Guided tour"
        title="Guided tour"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <QuestionIcon />
      </button>

      {open && (
        <>
          {/* Full-screen catcher: blocks interaction with the page behind the
              tour. Darkening comes from the spotlight's ring shadow when a
              target exists; otherwise this layer supplies it. */}
          <div
            className={`fixed inset-0 z-[60] ${rect ? "" : "bg-black/60"}`}
            aria-hidden
          />

          {/* Spotlight: a transparent hole over the target with a huge ring
              shadow that darkens everything else. */}
          {rect && (
            <div
              aria-hidden
              className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-indigo-400"
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
              }}
            />
          )}

          {/* Tooltip card — hidden until measured/positioned this frame so it
              never flashes at the wrong spot. */}
          <div
            ref={tipRef}
            role="dialog"
            aria-modal="true"
            className="fixed z-[61] rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"
            style={{
              width: TIP_WIDTH,
              top: tipPos?.top ?? 0,
              left: tipPos?.left ?? 0,
              visibility: tipPos ? "visible" : "hidden",
            }}
          >
            <h2 className="text-base font-semibold">{current.title}</h2>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">
              {current.body}
            </p>

            <div className="mt-4 flex items-center justify-between gap-3">
              {/* Skip — left */}
              <button
                onClick={finish}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Skip
              </button>

              {/* Progress dots — the current step stretches into a pill */}
              <div className="flex items-center gap-1.5">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step
                        ? "w-4 bg-indigo-600 dark:bg-indigo-400"
                        : "w-1.5 bg-gray-300 dark:bg-gray-600"
                    }`}
                  />
                ))}
              </div>

              {/* Back / Next — right */}
              <div className="flex gap-2">
                {step > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setStep((s) => s - 1)}
                  >
                    Back
                  </Button>
                )}
                {isLast ? (
                  <Button size="sm" onClick={finish}>
                    Done
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                    Next
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Standard "help" glyph: a question mark in a circle.
function QuestionIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  );
}
