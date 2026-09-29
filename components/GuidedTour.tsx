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
import { APP_TOUR_KEY, hasSeenTour, markTourSeen } from "@/lib/tourSeen";

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
//
// Ordered as the WORKFLOW runs, not as the tabs sit in the navbar: an admin
// asks for availability, you fill it in, you get scheduled, you confirm, and
// you hand a set off when you can't make it. Someone following the tour in
// order should end it knowing how a set gets from "proposed" to "yours".
const COMMON_STEPS: Step[] = [
  {
    title: "Welcome to Worship Scheduler",
    body: "Plan worship teams, track who's free, and hand sets off when you can't make one. Here's how a set gets from an admin's plan onto your calendar.",
  },
  {
    title: "It starts with a request",
    body: "An admin asks the team for availability. You'll see a red dot on the Availabilities tab until you've answered — that dot is the app's only nag, so it's worth clearing.",
    target: "/schedule",
    href: "/schedule",
  },
  {
    title: "Block the dates you can't serve",
    body: "Inside the request, mark the days or times you're away. A weekly commitment can repeat — forever, for a number of weeks, or until a date. If you're free the whole window, block nothing.",
    target: "avail-editors",
    href: "/schedule",
  },
  {
    title: "Drag across a run of days",
    body: "The fast way to block a holiday: click a day, or click and drag across a stretch of them, straight on the calendar.",
    target: "avail-calendar",
    href: "/schedule",
    desktopOnly: true,
  },
  {
    title: "Then say you're done",
    body: "Submit response is what tells the admin you've finished — without it they can’t tell “free all month” from “hasn’t looked yet”. You can reopen and change your answer any time after.",
    target: "avail-editors",
    href: "/schedule",
  },
  {
    title: "Calendar",
    body: "Once the admin builds the schedule, every upcoming set shows up here. Open one to see who's playing which role, read the set's notes and songs, and confirm your own spot.",
    target: "/calendar",
    href: "/calendar",
  },
  {
    title: "My Sets",
    body: "Everything you're on, grouped by what it's waiting on: sets needing your confirmation, covers and swaps in flight, and confirmed ones you can export to your own calendar. Confirm all clears the pending pile in one go.",
    target: "/set-manager",
    href: "/set-manager",
  },
  {
    title: "When you can't make one",
    body: "From My Sets, hand a set off: ask for a cover and anyone on that team who plays the role can take it, or propose a straight swap with a specific person's set. Either way an admin approves the handover before it's final — so you're not off the hook until they do.",
    target: "/set-manager",
    href: "/set-manager",
  },
  {
    title: "Switching orgs",
    body: "If you serve in more than one ministry — say your college group and TapWorship — each is its own org. Use this switcher to move between them; your calendar, sets, and requests all follow the org you pick.",
    target: "orgs",
  },
];

// Extra steps shown only to admins, covering the admin-only tabs.
const ADMIN_STEPS: Step[] = [
  {
    // The admin tabs are collapsed under a single "Admin" dropdown, so the
    // admin steps spotlight that trigger (their copy names the tab inside it).
    title: "Ask the team for availability",
    body: "Under the Admin menu, the Create tab is where the cycle starts: define your weekly recurring sets, then send an availability request for the window you're scheduling. The same tab shows you who has answered and who hasn't.",
    target: "/admin",
    href: "/create",
  },
  {
    title: "Build the schedule",
    body: "Generate New Schedule expands your recurring sets and fills them from who plays what and who's free — then hands you a preview to fix up before anything is saved. Nobody is created or messaged until you apply it. That preview has a Help button of its own with a tour of everything it can do.",
    target: "/admin",
    href: "/create",
  },
  {
    title: "Manage your team",
    body: "Under the Admin menu, the Team tab is where people live: add members, grant or revoke admin, set which roles each person plays, and organise ministry teams. Nobody can be scheduled until they have a role.",
    target: "/admin",
    href: "/users",
  },
  {
    title: "Editing what's already out",
    body: "Preview Mode on the Calendar opens the same review workspace over the sets you've already published, so you can shuffle people across weeks at once instead of set by set.",
    target: "/calendar",
    href: "/calendar",
    desktopOnly: true,
  },
];

// Closing step everyone sees last — highlights the user menu.
const PROFILE_STEP: Step = {
  title: "Your profile",
  body: "Open the menu under your name to check the teams you're on and the roles you play — your org admin sets both, so ask them if something's missing. Reopen this tour anytime from the “?” icon.",
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
    if (hasSeenTour(APP_TOUR_KEY)) return;
    setStep(0);
    setOpen(true);
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
    markTourSeen(APP_TOUR_KEY);
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
            <h2 className="text-lg font-semibold">{current.title}</h2>
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
