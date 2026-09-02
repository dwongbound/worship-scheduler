"use client";
// A compact grid of number inputs — one per role — for choosing a set or
// template's team shape (how many of each role to accept and fill).
//
// The roles come from the TEAM's catalog, not a fixed list: two teams can offer
// genuinely different roles, so the editor renders whatever this one has.
// Value is a full map over that catalog (parents seed it with
// resolveTeamCapacities so it never has holes). 0 means "we don't want any of
// this role" (e.g. no acoustic guitar on a Tuesday).
import { MAX_SLOTS_PER_ROLE, type BandRole } from "@/lib/constants";
import { slottedRoles, type TeamRoleDef } from "@/lib/teamRoles";

export default function SlotCapacityEditor({
  catalog,
  value,
  onChange,
  mins,
  disabled,
}: {
  // The team's role catalog. Choir is filtered out here — it has no slot count.
  catalog: TeamRoleDef[];
  value: Record<BandRole, number>;
  onChange: (next: Record<BandRole, number>) => void;
  // Per-role floor. Editing an EXISTING set passes how many people already
  // stand in each role, so the shape can't be cut out from under them; the
  // create forms omit it (nobody is assigned yet) and every floor is 0.
  mins?: Partial<Record<BandRole, number>>;
  disabled?: boolean;
}) {
  const minFor = (role: BandRole) => mins?.[role] ?? 0;

  const setRole = (role: BandRole, raw: string) => {
    // Clamp to [min, MAX] and coerce blank/NaN to the floor so state stays a
    // valid map.
    const n = Math.max(
      minFor(role),
      Math.min(MAX_SLOTS_PER_ROLE, Math.floor(Number(raw) || 0))
    );
    onChange({ ...value, [role]: n });
  };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {slottedRoles(catalog).map((role) => (
        <label
          key={role.key}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="text-gray-700 dark:text-gray-300">{role.label}</span>
          <input
            type="number"
            min={minFor(role.key)}
            max={MAX_SLOTS_PER_ROLE}
            value={value[role.key] ?? 0}
            disabled={disabled}
            aria-label={role.label}
            title={
              minFor(role.key) > 0
                ? `${minFor(role.key)} already assigned — remove them from the set to go lower.`
                : undefined
            }
            onChange={(e) => setRole(role.key, e.target.value)}
            className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm
              focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
              disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
      ))}
    </div>
  );
}
