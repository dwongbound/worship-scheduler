"use client";
// A compact grid of number inputs — one per instrument — for choosing a
// set/template's team shape (how many of each role to accept and fill).
// Shared by the Create tab's template form and the calendar's ad-hoc create
// modal. Value is always a FULL map (every role present); parents seed it
// from resolveCapacities() so it never has holes. 0 means "we don't want any
// of this instrument" (e.g. no acoustic guitars on a Tuesday).
import {
  INSTRUMENT_LABELS,
  MAX_SLOTS_PER_ROLE,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";

export default function SlotCapacityEditor({
  value,
  onChange,
  disabled,
}: {
  value: Record<Instrument, number>;
  onChange: (next: Record<Instrument, number>) => void;
  disabled?: boolean;
}) {
  const setRole = (role: Instrument, raw: string) => {
    // Clamp to [0, MAX] and coerce blank/NaN to 0 so state stays a valid map.
    const n = Math.max(0, Math.min(MAX_SLOTS_PER_ROLE, Math.floor(Number(raw) || 0)));
    onChange({ ...value, [role]: n });
  };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {ROLE_ORDER.map((role) => (
        <label
          key={role}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="text-gray-700 dark:text-gray-300">
            {INSTRUMENT_LABELS[role]}
          </span>
          <input
            type="number"
            min={0}
            max={MAX_SLOTS_PER_ROLE}
            value={value[role]}
            disabled={disabled}
            onChange={(e) => setRole(role, e.target.value)}
            className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm
              focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
              disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
      ))}
    </div>
  );
}
