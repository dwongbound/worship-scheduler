"use client";

// The guided tour of the review workspace, opened by its Help button.
//
// A stepped modal rather than spotlights cut out of the real page: the screen
// it explains scrolls in two directions and rearranges itself between its two
// groupings, so anything anchored to a live element would be pointing at empty
// space half the time. Each step instead carries a small drawing of the thing
// it is describing, which stays true wherever the real one has scrolled to.
//
// The words live in lib/scheduleTour.ts; this file is layout only.
import { useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import { tourSteps, type TourArt } from "@/lib/scheduleTour";

export default function ScheduleHelpModal({
  open,
  preview,
  onClose,
}: {
  open: boolean;
  // Preview Mode edits real sets, so its first and last steps differ.
  preview: boolean;
  onClose: () => void;
}) {
  const steps = tourSteps({ preview });
  const [idx, setIdx] = useState(0);
  // Every opening starts at the beginning. Someone who closed the tour halfway
  // through and came back wants the tour, not the middle of it.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  // Escape belongs to the TOP modal. Every Modal closes on a document-level
  // keydown, and the workspace this one is explaining is listening too — so
  // without this, dismissing the tour would also back out of the plan behind
  // it (and on a freshly generated one, that means the discard prompt). Caught
  // in the CAPTURE phase at the document, which runs before the bubble-phase
  // listeners both Modals registered there, so stopping propagation stops them
  // both and this closes itself instead.
  useEffect(() => {
    if (!open) return;
    const swallowEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", swallowEscape, true);
    return () => document.removeEventListener("keydown", swallowEscape, true);
  }, [open, onClose]);

  const step = steps[idx];
  const first = idx === 0;
  const last = idx === steps.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Guided tour"
      footer={
        <div className="flex w-full items-center gap-2">
          {/* The dots are the only sense of length the tour gives, so they sit
              opposite the controls rather than being tucked beside them. */}
          <div className="mr-auto flex items-center gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx
                    ? "w-4 bg-indigo-600 dark:bg-indigo-400"
                    : "w-1.5 bg-gray-300 dark:bg-gray-600"
                }`}
              />
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={() => setIdx((i) => i - 1)}
            disabled={first}
          >
            Back
          </Button>
          <Button onClick={() => (last ? onClose() : setIdx((i) => i + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      }
    >
      {step && (
        <div className="space-y-4">
          <StepArt art={step.art} preview={preview} />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {step.title}
            </h3>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              Step {idx + 1} of {steps.length}
            </p>
          </div>
          <div className="space-y-2.5">
            {step.body.map((para) => (
              <p
                key={para}
                className="text-sm leading-relaxed text-gray-600 dark:text-gray-300"
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── The little drawings ──────────────────────────────────────────────────────
// Deliberately crude: enough shape to recognise the thing being described,
// never so much detail that it has to be kept in step with the real UI. Built
// from the same tokens as the real screen so both themes come out right.

function StepArt({ art, preview }: { art: TourArt; preview: boolean }) {
  return (
    <div
      className="flex h-28 items-center justify-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
      aria-hidden
    >
      {art === "overview" && (
        <>
          <MiniCard rows={3} />
          <MiniCard rows={3} />
          <MiniCard rows={3} />
        </>
      )}

      {art === "views" && (
        <>
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              <MiniCard rows={2} w="w-8" />
              <MiniCard rows={2} w="w-8" />
              <MiniCard rows={2} w="w-8" />
            </div>
            <span className="text-[10px] text-gray-500">By set type</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              <MiniCard rows={2} w="w-8" />
              <MiniCard rows={2} w="w-8" />
              <MiniCard rows={2} w="w-8" />
            </div>
            <span className="text-[10px] text-gray-500">Chronological</span>
          </div>
        </>
      )}

      {art === "load" && (
        <div className="w-48 space-y-2">
          <Bar pct={100} tone="amber" n="20" />
          <Bar pct={60} tone="teal" n="12" />
          <Bar pct={35} tone="teal" n="7" />
        </div>
      )}

      {art === "hover" && (
        <div className="flex items-center gap-2">
          <MiniCard rows={3} highlight={1} />
          <MiniCard rows={3} highlight={0} />
          <MiniCard rows={3} highlight={2} />
        </div>
      )}

      {art === "lock" && (
        <div className="w-44 space-y-1.5">
          <SlotRow label="Carol Chen" locked />
          <SlotRow label="Dave Diaz" />
          <SlotRow label="Nina Nguyen" locked />
        </div>
      )}

      {art === "card" && (
        <div className="w-40 rounded-md border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-900">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="h-1.5 w-14 rounded bg-gray-300 dark:bg-gray-600" />
            <span className="text-xs text-gray-400">↻</span>
          </div>
          <SlotRow label="Keys" removable />
          <SlotRow label="Bass" removable />
          <div className="mt-1.5 flex gap-1">
            <span className="rounded-full border border-dashed border-gray-300 px-1.5 text-[9px] text-gray-400 dark:border-gray-600">
              + Vox
            </span>
          </div>
        </div>
      )}

      {art === "clipboard" && (
        <>
          <MiniCard rows={3} selected />
          <span className="text-lg text-gray-400">→</span>
          <MiniCard rows={3} />
        </>
      )}

      {art === "warnings" && (
        <div className="space-y-2">
          <span className="block rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
            Keys — no one available
          </span>
          <span className="block rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
            Bob Baker · unavailable
          </span>
        </div>
      )}

      {/* The real action bar, in miniature — so it has to be the bar this mode
          actually shows. Drawing a Save Draft button for Preview Mode would be
          pointing at something that isn't there. */}
      {art === "commit" && (
        <div className="flex items-center gap-2">
          {preview ? (
            <>
              <span className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                Cancel
              </span>
              <span className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] text-white">
                Save Changes
              </span>
            </>
          ) : (
            <>
              <span className="rounded-md bg-red-600 px-2 py-1 text-[10px] text-white">
                Discard
              </span>
              <span className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                Save Draft
              </span>
              <span className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] text-white">
                Apply
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// A set card, shrunk to its silhouette. `highlight` tints one row the way
// hovering a name tints that person's slots.
function MiniCard({
  rows,
  w = "w-12",
  highlight,
  selected,
}: {
  rows: number;
  w?: string;
  highlight?: number;
  selected?: boolean;
}) {
  return (
    <div
      className={`${w} space-y-1 rounded border-2 bg-white p-1.5 dark:bg-gray-900 ${
        selected
          ? "border-indigo-500 dark:border-indigo-400"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className={`block h-1.5 rounded ${
            i === highlight
              ? "bg-indigo-400 dark:bg-indigo-500"
              : "bg-gray-200 dark:bg-gray-700"
          }`}
        />
      ))}
    </div>
  );
}

// One Team load row: name, bar, count.
function Bar({ pct, tone, n }: { pct: number; tone: "amber" | "teal"; n: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span className="h-1.5 w-12 self-center rounded bg-gray-300 dark:bg-gray-600" />
        <span>{n}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full rounded-full ${
            tone === "amber" ? "bg-amber-500" : "bg-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// One slot in a card: optional ✕, a name box, optional padlock.
function SlotRow({
  label,
  locked,
  removable,
}: {
  label: string;
  locked?: boolean;
  removable?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {removable && <span className="text-[9px] text-gray-400">✕</span>}
      <span className="flex-1 truncate rounded border border-gray-300 bg-white px-1 py-0.5 text-[9px] text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
        {label}
      </span>
      {locked && <span className="text-[9px]">🔒</span>}
    </div>
  );
}
