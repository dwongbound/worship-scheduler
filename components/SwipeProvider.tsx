"use client";
// Shared state for the phone tab-swipe gesture. The navbar owns the tab list
// (with its admin logic) and writes it here each render; SwipePager owns the
// touch gesture and reads it. `previewIndex` flows the other way: SwipePager
// sets it mid-drag so the navbar can highlight the tab you're swiping toward
// before the navigation actually commits.
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

type Navigate = (href: string) => void;

interface SwipeCtx {
  // Written by the navbar, read by the pager's gesture handler.
  tabsRef: React.MutableRefObject<string[]>;
  activeIndexRef: React.MutableRefObject<number>;
  navigateRef: React.MutableRefObject<Navigate>;
  // Set by the pager mid-drag, read by the navbar for a live highlight.
  // null = no preview, fall back to the real active tab.
  previewIndex: number | null;
  setPreviewIndex: (i: number | null) => void;
}

const Ctx = createContext<SwipeCtx | null>(null);

export function SwipeProvider({ children }: { children: ReactNode }) {
  const tabsRef = useRef<string[]>([]);
  const activeIndexRef = useRef(0);
  const navigateRef = useRef<Navigate>(() => {});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  return (
    <Ctx.Provider
      value={{ tabsRef, activeIndexRef, navigateRef, previewIndex, setPreviewIndex }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSwipe(): SwipeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSwipe must be used within a SwipeProvider");
  return ctx;
}
