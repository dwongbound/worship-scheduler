"use client";
// The fields shared by every "create a set" form: a label (optional — the
// ad-hoc form types the name into the modal heading instead), a start and END
// time, and an optional custom team shape. Used by both the calendar's
// ad-hoc CreateSetModal and the Create tab's TemplateModal — whatever differs
// between them (a fixed date vs. a recurring day-of-week) is passed in as the
// `scheduleField` slot, which renders right under the label.
import { ReactNode } from "react";
import Input from "./common/Input";
import {
  durationBetween,
  minutesToTimeInput,
  timeStringToMinutes,
} from "@/lib/dates";
import Select from "./common/Select";
import Checkbox from "./common/Checkbox";
import SlotCapacityEditor from "./SlotCapacityEditor";
import type { BandRole } from "@/lib/constants";
import {
  DEFAULT_TEAM_ROLES,
  resolveTeamCapacities,
  teamSupportsMD,
} from "@/lib/teamRoles";
import type { ApiTeam } from "@/lib/types";

// A set's length, for the hint under the times. The form asks for a start and
// an end; the minutes between them are what's actually stored/sent.
function durationLabel(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hr${hrs === 1 ? "" : "s"}`;
  return `${hrs} hr ${mins} min`;
}

// The controlled state every set form carries. `capacities` is null until the
// admin opts into a custom team shape, so callers can send it as-is (null →
// the set uses the global default team shape).
export interface SetFormState {
  label: string;
  startTime: string; // "09:00"
  // Still stored as a length in minutes (that's what the API takes), but the
  // form edits it as an END TIME — see the Start/End inputs below.
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
  showLabel = true,
  labelRequired = false,
  labelPlaceholder = "e.g. Sunday Morning Service",
  allowPrivate = false,
  disabled,
}: {
  state: SetFormState;
  onChange: (next: SetFormState) => void;
  scheduleField?: ReactNode; // date (calendar) or day-of-week (template)
  teams: ApiTeam[]; // the set is created FOR one of these (empty = loading)
  // Render the "Label" field. Off for the ad-hoc set form, where the modal's
  // own heading is the name field (see CreateSetModal) — two places to type a
  // name for the same set read as two different things.
  showLabel?: boolean;
  labelRequired?: boolean;
  labelPlaceholder?: string;
  // Show the "Private" checkbox (ad-hoc sets only — templates don't have it).
  allowPrivate?: boolean;
  disabled?: boolean;
}) {
  const patch = (p: Partial<SetFormState>) => onChange({ ...state, ...p });
  const customizing = state.capacities !== null;
  // The shape editor speaks the SELECTED team's roles — different teams offer
  // different ones, so switching teams changes what's on offer here.
  const catalog =
    teams.find((t) => t.id === state.teamId)?.roles ?? DEFAULT_TEAM_ROLES;

  return (
    <div className="space-y-3">
      {showLabel && (
        <Input
          label="Label"
          value={state.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder={labelPlaceholder}
          required={labelRequired}
          disabled={disabled}
        />
      )}

      {scheduleField}

      {/* Which team this set is for — only its members can be scheduled. */}
      <Select
        label="Team"
        value={state.teamId}
        // Switching teams drops any custom shape: its keys belong to the old
        // team's roles and would mean nothing against the new one's.
        onChange={(e) => patch({ teamId: e.target.value, capacities: null })}
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

      {/* Start + END time. The set still STORES a duration, so the end time is
          derived from it: moving the start slides the end along and keeps the
          set the same length, while editing the end re-measures it. An end at
          or before the start reads as running past midnight (durationBetween);
          typing the start time back over the end is ignored rather than
          collapsing the set to nothing. */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Start time"
          type="time"
          value={state.startTime}
          onChange={(e) => patch({ startTime: e.target.value })}
          required
          disabled={disabled}
        />
        <Input
          label="End time"
          type="time"
          value={minutesToTimeInput(
            timeStringToMinutes(state.startTime) + state.duration
          )}
          onChange={(e) => {
            const duration = durationBetween(state.startTime, e.target.value);
            if (duration !== null) patch({ duration });
          }}
          required
          disabled={disabled}
        />
      </div>
      <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">
        {durationLabel(state.duration)} long
      </p>

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
          for this set. (MDs can still play any role on any set either way.)
          Hidden entirely for a team whose catalog has no MD role. */}
      {teamSupportsMD(catalog) && (
        <Checkbox
          label="Add MD"
          checked={state.requiresMD}
          onChange={(e) => patch({ requiresMD: e.target.checked })}
          disabled={disabled}
        />
      )}

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
            patch({
              capacities: customizing
                ? null
                : resolveTeamCapacities(catalog, null),
            })
          }
          className="text-sm font-medium text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
        >
          {customizing ? "Use default team shape" : "Customize team shape"}
        </button>
        {customizing && state.capacities && (
          <div className="mt-2">
            <SlotCapacityEditor
              catalog={catalog}
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
