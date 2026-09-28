"use client";
// The "which set types?" checklist, shared by the two dialogs that ask it:
//   • GenerateModal — which recurring sets to expand into the new plan.
//   • PreviewModeModal — which set types to draw into the calendar preview.
// Both pick from a list and both hang an optional preview COLOUR off each
// pick, so the list, the "Select all"/"Clear all" toggle and the colour
// swatches live here once.
//
// The colour is only ever a reading aid for the review workspace
// (StagedScheduleModal tints a type's cards with it) — nothing colour-related
// is ever saved.
import Badge from "./common/Badge";
import Checkbox from "./common/Checkbox";
import ColorPicker from "./common/ColorPicker";
import InfoTooltip from "./common/InfoTooltip";
import type { ReactNode } from "react";

/** One row: what to tick, and what to say about it. */
export interface SetTypeOption {
  id: string;
  label: string;
  // The muted line beside the name — a recurrence ("Sun 6:45AM"), a count, or
  // nothing at all.
  meta?: string;
  // A chip after the name, normally the team the sets belong to.
  badge?: string;
}

/** id → "#rrggbb". Absent = that type isn't tinted. */
export type SetTypeColors = Record<string, string>;

export default function SetTypePicker({
  legend,
  info,
  options,
  picked,
  onPickedChange,
  colors,
  onColorsChange,
  emptyText,
}: {
  legend: string;
  // Text behind the (i) beside the legend.
  info: string;
  options: SetTypeOption[];
  picked: string[];
  onPickedChange: (next: string[]) => void;
  colors: SetTypeColors;
  onColorsChange: (next: SetTypeColors) => void;
  // Shown in place of the list when there's nothing to pick.
  emptyText: ReactNode;
}) {
  const allPicked = options.length > 0 && picked.length === options.length;

  const toggle = (id: string) =>
    onPickedChange(
      picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    );

  const setColor = (id: string, hex: string | null) => {
    const next = { ...colors };
    if (hex) next[id] = hex;
    else delete next[id];
    onColorsChange(next);
  };

  return (
    <fieldset className="border-t border-gray-200 pt-4 dark:border-gray-700">
      <div className="mb-2 flex items-center justify-between gap-3">
        <legend className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {legend}
          <InfoTooltip text={info} />
        </legend>
        {options.length > 1 && (
          <button
            type="button"
            onClick={() =>
              onPickedChange(allPicked ? [] : options.map((o) => o.id))
            }
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {allPicked ? "Clear all" : "Select all"}
          </button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {options.map((o) => {
            const checked = picked.includes(o.id);
            return (
              // min-h-5 matches the text line and the colour swatch alike, so
              // a row is the same height whether it's showing a swatch or not
              // — the list doesn't jump as types are ticked.
              <li key={o.id} className="flex min-h-5 items-center gap-2">
                {/* min-w-0 so a long set name truncates rather than shoving the
                    colour swatch off the row. */}
                <span className="min-w-0 flex-1">
                  <Checkbox
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{o.label}</span>
                        {o.meta && (
                          <span className="shrink-0 text-gray-500 dark:text-gray-400">
                            {o.meta}
                          </span>
                        )}
                        {o.badge && <Badge tone="indigo">{o.badge}</Badge>}
                      </span>
                    }
                    checked={checked}
                    onChange={() => toggle(o.id)}
                  />
                </span>
                {/* The colour only means something for a type that's being
                    drawn, so the swatch appears with the tick. */}
                {checked && (
                  <span className="shrink-0">
                    <ColorPicker
                      value={colors[o.id] ?? null}
                      label={`Preview color for ${o.label}`}
                      onChange={(hex) => setColor(o.id, hex)}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
