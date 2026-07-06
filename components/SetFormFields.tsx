"use client";
// The fields shared by every "create a set" form: a label, a start time +
// duration, and an optional custom team shape. Used by both the calendar's
// ad-hoc CreateSetModal and the Create tab's TemplateModal — whatever differs
// between them (a fixed date vs. a recurring day-of-week) is passed in as the
// `scheduleField` slot, which renders right under the label.
import { ReactNode, useState } from "react";
import Input from "./common/Input";
import Select from "./common/Select";
import SlotCapacityEditor from "./SlotCapacityEditor";
import { resolveCapacities, type Instrument } from "@/lib/constants";

// Set durations, offered in half-hour steps (0.5h–8h) but stored as minutes.
const DURATION_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);
function durationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "Hr" : "Hrs"}`;
}

// The controlled state every set form carries. `capacities` is null until the
// admin opts into a custom team shape, so callers can send it as-is (null →
// the set uses the global default team shape).
export interface SetFormState {
  label: string;
  startTime: string; // "09:00"
  duration: number; // minutes
  capacities: Record<Instrument, number> | null;
}

// A fresh, default form state (blank label, 9am, 90 min, default team shape).
export function emptySetForm(): SetFormState {
  return { label: "", startTime: "09:00", duration: 90, capacities: null };
}

export default function SetFormFields({
  state,
  onChange,
  scheduleField,
  labelRequired = false,
  labelPlaceholder = "e.g. Sunday Morning Service",
  disabled,
}: {
  state: SetFormState;
  onChange: (next: SetFormState) => void;
  scheduleField?: ReactNode; // date (calendar) or day-of-week (template)
  labelRequired?: boolean;
  labelPlaceholder?: string;
  disabled?: boolean;
}) {
  const patch = (p: Partial<SetFormState>) => onChange({ ...state, ...p });
  const customizing = state.capacities !== null;

  return (
    <div className="space-y-3">
      <Input
        label="Label"
        value={state.label}
        onChange={(e) => patch({ label: e.target.value })}
        placeholder={labelPlaceholder}
        required={labelRequired}
        disabled={disabled}
      />

      {scheduleField}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Start time"
          type="time"
          value={state.startTime}
          onChange={(e) => patch({ startTime: e.target.value })}
          required
          disabled={disabled}
        />
        <Select
          label="Duration"
          value={state.duration}
          onChange={(e) => patch({ duration: Number(e.target.value) })}
          disabled={disabled}
        >
          {DURATION_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {durationLabel(minutes)}
            </option>
          ))}
        </Select>
      </div>

      {/* Team shape is opt-in: null capacities means "use the default team".
          Toggling on seeds the editor with the defaults; toggling off clears
          back to null so the set inherits the global shape. */}
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            patch({ capacities: customizing ? null : resolveCapacities(null) })
          }
          className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
        >
          {customizing ? "Use default team shape" : "Customize team shape"}
        </button>
        {customizing && state.capacities && (
          <div className="mt-2">
            <SlotCapacityEditor
              value={state.capacities}
              onChange={(c) => patch({ capacities: c })}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
