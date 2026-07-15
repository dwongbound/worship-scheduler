"use client";

import { useEffect, useState } from "react";

// Floating "back to top" button. Desktop-only (hidden on phones, which use the
// bottom nav bar): appears once the user has scrolled at least half a viewport
// down, and smooth-scrolls to the top when clicked.
export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Half a screen down is the threshold to reveal the button.
      setVisible(window.scrollY > window.innerHeight / 2);
    };
    onScroll(); // sync initial state (e.g. on a restored scroll position)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-6 right-6 z-40 hidden h-11 w-11 items-center justify-center rounded-full bg-gray-700/90 text-gray-100 shadow-lg ring-1 ring-black/10 transition-opacity hover:bg-gray-700 dark:bg-gray-700/80 dark:text-gray-100 dark:ring-white/10 dark:hover:bg-gray-600 sm:flex ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}
