"use client";
// Full-screen loading splash shown while the app boots or a route loads.
// The app name breathes (pulses) above a set of animated "worship" equalizer
// bars, framed by radiating rings of light. Wired into app/loading.tsx so
// Next.js shows it during route-level Suspense.

const APP_NAME = "Worship Scheduler";
// Fixed subtext — the same on every full-screen loader, by design.
const SUBTEXT = "\"I'm calling on the God of Dacob\" — Joe Lee";

// Equalizer bar heights + per-bar timing, tuned so it reads like music
// rather than a mechanical loop. Colors are drawn from the app favicon
// (app/icon.svg): orange, crimson, teal, yellow, green.
const BARS = [
  { h: "h-6", delay: "0s", dur: "0.9s", color: "#E0913C" },
  { h: "h-10", delay: "0.15s", dur: "1.1s", color: "#C13454" },
  { h: "h-14", delay: "0.3s", dur: "0.8s", color: "#3E8A9E" },
  { h: "h-10", delay: "0.05s", dur: "1.2s", color: "#E8D06A" },
  { h: "h-8", delay: "0.25s", dur: "1s", color: "#2E6E5E" },
];

export default function LoadingScreen() {
  return (
    // z-20 sits below the sticky navbar (z-30) so the nav stays visible while
    // a page loads.
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-20 flex flex-col items-center justify-center gap-8
        bg-gray-50 dark:bg-gray-900"
    >
      {/* Mark: radiating rings behind the animated worship equalizer. */}
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span
          className="absolute h-24 w-24 rounded-full animate-radiate"
          style={{ backgroundColor: "rgba(193,52,84,0.18)" }}
        />
        <span
          className="absolute h-24 w-24 rounded-full animate-radiate"
          style={{ backgroundColor: "rgba(62,138,158,0.18)", animationDelay: "1s" }}
        />
        <div className="flex items-end gap-1.5" aria-hidden="true">
          {BARS.map((bar, i) => (
            <span
              key={i}
              className={`${bar.h} w-2.5 origin-bottom rounded-full animate-equalize`}
              style={{
                backgroundColor: bar.color,
                animationDelay: bar.delay,
                animationDuration: bar.dur,
              }}
            />
          ))}
        </div>
      </div>

      {/* Pulsing app name (favicon crimson). */}
      <h1
        className="animate-pulse-name text-2xl font-bold tracking-tight"
        style={{ color: "#C13454" }}
      >
        {APP_NAME}
      </h1>

      <p className="text-sm text-gray-500 dark:text-gray-400">{SUBTEXT}</p>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
