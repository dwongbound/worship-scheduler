"use client";
// Step 1 of the calendar's admin-only "Preview Mode": which set types to draw.
//
// It's GenerateModal's sibling — the same checklist of set types with the same
// optional preview colours (SetTypePicker does that work for both) — minus the
// "Schedule for" section, because nothing is being scheduled here. Ticking a
// type just says "include these sets", and "See preview" hands the picks to
// the caller, which builds the staged plan out of the calendar's real sets and
// opens StagedScheduleModal on it.
//
// The rows come from lib/calendarPreview.previewSetTypes: one per recurring set
// that actually has sets in view, plus an "Other" bucket for everything that
// came from no recurring set — private sets, one-offs, sets whose recurring
// set was since renamed.
import { useEffect, useRef, useState } from "react";
import Button from "./common/Button";
import InfoTooltip from "./common/InfoTooltip";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import SetTypePicker, { type SetTypeColors } from "./SetTypePicker";
import { DAY_ABBRS } from "@/lib/constants";
import { minutesToShortTimeLabel } from "@/lib/dates";
import type { PreviewSetType } from "@/lib/calendarPreview";

export default function PreviewModeModal({
  open,
  setTypes,
  // The set types are derived from sets that may still be loading (the page
  // fetches its recurring sets on the first open).
  loading,
  onPreview,
  onClose,
}: {
  open: boolean;
  setTypes: PreviewSetType[];
  loading: boolean;
  // Colours ride alongside the picks: they're a preview-only reading aid and
  // never reach the API (nothing here ever does).
  onPreview: (typeIds: string[], colors: SetTypeColors) => void;
  onClose: () => void;
}) {
  // Everything ticked on open — the usual intent is "show me the calendar",
  // and unticking is the deliberate act (same default as GenerateModal).
  const [picked, setPicked] = useState<string[]>([]);
  // Tints are a per-open choice, so a fresh dialog starts uncoloured.
  const [colors, setColors] = useState<SetTypeColors>({});
  // "Everything ticked" is the OPENING state, not a standing rule.
  //
  // Two things make that subtle. The caller rebuilds this array on every
  // render, so the effect is keyed on the list's CONTENTS (typeKey) rather than
  // its identity. And the contents legitimately change while the dialog is
  // open — the list starts with just "Other" and grows a row per recurring set
  // when that fetch lands — which used to re-tick everything and wipe an
  // untick the admin had already made. So once they've touched the picks, we
  // keep them and only drop ids that no longer exist.
  const typeKey = setTypes.map((t) => t.id).join("|");
  const touched = useRef(false);
  useEffect(() => {
    if (open) touched.current = false;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (touched.current) {
      setPicked((prev) =>
        prev.filter((id) => setTypes.some((t) => t.id === id))
      );
      return;
    }
    setPicked(setTypes.map((t) => t.id));
    // setTypes is deliberately not a dep — typeKey stands in for its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, typeKey]);

  // Any pick the admin makes themselves is theirs to keep.
  const choosePicked = (next: string[]) => {
    touched.current = true;
    setPicked(next);
  };
  useEffect(() => {
    if (open) setColors({});
  }, [open]);

  if (!open) return null;

  const blocked = loading
    ? "Still loading your sets."
    : setTypes.length === 0
      ? "No upcoming sets on the calendar to preview."
      : picked.length === 0
        ? "Pick at least one set type."
        : null;

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Preview mode"
      titleAccessory={
        <InfoTooltip
          text="A read-only look at the whole upcoming schedule — the same workspace as the Create tab's preview, filled in with who's already on each set. Nothing you do in it is saved."
          // The title sits at the top of the viewport, where an upward bubble
          // would be cut off by the window edge.
          side="bottom"
        />
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onPreview(picked, colors)}
            disabled={!!blocked}
            title={blocked ?? undefined}
          >
            See preview
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Pick the set types to show. The preview covers the upcoming sets
          already on your calendar, with the people already on them.
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <LoadingDots label="Loading your recurring sets" />
          </div>
        ) : (
          <SetTypePicker
            legend="Set types to show"
            info="Each type's color tints its cards in the preview, so you can tell at a glance which kind of set a card is. “Other” covers everything that didn't come from a recurring set — private sets, one-offs, and anything renamed since."
            options={setTypes.map((t) => ({
              id: t.id,
              label: t.label,
              // Recurring sets show when they land; "Other" has no recurrence,
              // so its row leads with the count instead.
              meta:
                t.dayOfWeek !== null && t.startMinute !== null
                  ? `${DAY_ABBRS[t.dayOfWeek]} ${minutesToShortTimeLabel(
                      t.startMinute
                    )} · ${t.count} set${t.count === 1 ? "" : "s"}`
                  : `${t.count} set${t.count === 1 ? "" : "s"}`,
              badge: t.team?.name,
            }))}
            picked={picked}
            onPickedChange={choosePicked}
            colors={colors}
            onColorsChange={setColors}
            emptyText="No upcoming sets on the calendar yet — there's nothing to preview."
          />
        )}
      </div>
    </Modal>
  );
}
