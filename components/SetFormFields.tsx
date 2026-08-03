"use client";
// The fields shared by every "create a set" form: a label, a start time +
// duration, and an optional custom team shape. Used by both the calendar's
// ad-hoc CreateSetModal and the Create tab's TemplateModal — whatever differs
// between them (a fixed date vs. a recurring day-of-week) is passed in as the
// `scheduleField` slot, which renders right under the label.
import { ReactNode } from "react";
import Input from "./common/Input";
import Select from "./common/Select";
import Checkbox from "./common/Checkbox";
import SlotCapacityEditor from "./SlotCapacityEditor";
import { resolveCapacities, type BandRole } from "@/lib/constants";
import type { ApiTeam } from "@/lib/types";

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
  requiresMD: boolean; // set needs a musical director on its team
  isPrivate: boolean; // only admins + assigned people can see this set
  // Auto-create the set's private Slack channel this many days before it starts;
  // null = off. (Distinct from the team's standing summary channel.)
  groupChatLeadDays: number | null;
  capacities: Record<BandRole, number> | null;
  // Which team the set is for. "" until the teams list loads; callers default
  // it to the first team and block submit while it's empty.
  teamId: string;
}

// A fresh, default form state (blank label, 9am, 90 min, default team shape).
export function emptySetForm(): SetFormState {
  return {
    label: "",
    startTime: "09:00",
    duration: 90,
    requiresMD: false,
    isPrivate: false,
    groupChatLeadDays: null,
    capacities: null,
    teamId: "",
  };
}

export default function SetFormFields({
  state,
  onChange,
  scheduleField,
  teams,
  labelRequired = false,
  labelPlaceholder = "e.g. Sunday Morning Service",
  allowPrivate = false,
  disabled,
}: {
  state: SetFormState;
  onChange: (next: SetFormState) => void;
  scheduleField?: ReactNode; // date (calendar) or day-of-week (template)
  teams: ApiTeam[]; // the set is created FOR one of these (empty = loading)
  labelRequired?: boolean;
  labelPlaceholder?: string;
  // Show the "Private" checkbox (ad-hoc sets only — templates don't have it).
  allowPrivate?: boolean;
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

      {/* Which team this set is for — only its members can be scheduled. */}
      <Select
        label="Team"
        value={state.teamId}
        onChange={(e) => patch({ teamId: e.target.value })}
        required
        disabled={disabled || teams.length === 0}
      >
        {teams.length === 0 ? (
          <option value="">Loading teams…</option>
        ) : (
          teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))
        )}
      </Select>

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

      {/* Auto-create the set's private Slack channel this many days before it
          starts. Blank = off (an admin can still make one by hand with the
          set's "Slack Team" button). The org must have Slack connected. */}
      <Input
        label="Auto-create group chat (days before, blank = off)"
        type="number"
        min={1}
        value={state.groupChatLeadDays ?? ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          patch({
            groupChatLeadDays:
              e.target.value === "" || Number.isNaN(n) ? null : n,
          });
        }}
        placeholder="Off"
        disabled={disabled}
      />

      {/* On: this set wants a musical director — the auto-scheduler seats one
          and the set detail modal shows the MD picker. Off: no MD is tracked
          for this set. (MDs can still play any role on any set either way.) */}
      <Checkbox
        label="Add MD"
        checked={state.requiresMD}
        onChange={(e) => patch({ requiresMD: e.target.checked })}
        disabled={disabled}
      />

      {/* Private ad-hoc set: hidden from everyone except org admins and the
          people assigned to it. Offered only when creating a one-off set. */}
      {allowPrivate && (
        <Checkbox
          label="Private (only admins + assigned people can see this set)"
          checked={state.isPrivate}
          onChange={(e) => patch({ isPrivate: e.target.checked })}
          disabled={disabled}
        />
      )}

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
