// Pure model for the "master schedule" grid Excel export: roles down the side,
// service dates across the top, each cell = who's assigned. Kept dependency-free
// and side-effect-free so it's unit-testable (tests/unit/scheduleGrid.test.ts);
// the Excel styling lives in the export route, this just decides the shape.
import type { BandRole, Instrument, SlotCapacityMap } from "./constants";
import {
  DEFAULT_TEAM_ROLES,
  bandRoles,
  orderedRoles,
  resolveTeamCapacities,
  type TeamRoleDef,
} from "./teamRoles";
import { appTimeZone } from "./ics";

// The minimal shape of a set this builder needs (a projection of the DB rows).
export interface GridSet {
  id: string;
  label: string | null;
  notes: string | null;
  startsAt: Date;
  slotCapacities: SlotCapacityMap | null;
  // The catalog of THIS set's team. A grid can span teams with different role
  // lists, so each set brings its own; omitted = the built-in defaults.
  roles?: TeamRoleDef[] | null;
  assignments: { role: Instrument; userName: string }[];
}

// One column = one set. `dateKey` groups columns on the same day so the export
// can merge their date header; `cells[role]` is that set's names per slot row.
export interface GridColumn {
  setId: string;
  dateKey: string; // YYYY-MM-DD in the app timezone (grouping key, not shown)
  dateLabel: string; // "Tuesday 8/4"
  timeLabel: string; // "7:00 AM"
  memo: string; // set label + notes, one line
  cells: Record<BandRole, string[]>;
}

// One body row = one slot of one role. Vox (capacity 3) yields three rows, all
// labelled "Vox"; `slot` is its 0-based index within that role.
export interface GridRoleRow {
  role: BandRole;
  label: string;
  slot: number;
}

export interface ScheduleGrid {
  columns: GridColumn[];
  roleRows: GridRoleRow[];
}

// Wall-clock date/time parts of an instant in a timezone (Intl does the DST math).
function zoned(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    month: get("month"),
    day: get("day"),
    year: get("year"),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}`,
  };
}

/**
 * Build the grid from a set list. Columns are the sets in chronological order;
 * body rows are every band role, scarce-first, one row per slot. A role's row
 * count is the largest slot demand across all columns — the bigger of its
 * capacity or its actual assignment count — so no set's names overflow.
 *
 * Roles are per-team, so a grid spanning several teams shows the UNION of their
 * catalogs: a role only one team has simply leaves the other team's columns
 * blank, which is exactly how it reads on paper.
 */
export function buildScheduleGrid(
  sets: GridSet[],
  timeZone: string = appTimeZone()
): ScheduleGrid {
  const ordered = [...sets].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  const catalogFor = (set: GridSet) =>
    set.roles?.length ? set.roles : DEFAULT_TEAM_ROLES;

  // The union of every column's roles, keeping the first catalog's label and
  // ordering for any role two teams share.
  const union = new Map<string, TeamRoleDef>();
  for (const set of ordered) {
    for (const role of bandRoles(catalogFor(set))) {
      if (!union.has(role.key)) union.set(role.key, role);
    }
  }
  const allRoles = orderedRoles([...union.values()]);

  // Names each set has in each role, in assignment order.
  const namesByRole = (set: GridSet) => {
    const map = {} as Record<BandRole, string[]>;
    for (const role of allRoles) map[role.key] = [];
    for (const a of set.assignments) {
      if (a.role in map) map[a.role].push(a.userName);
    }
    return map;
  };

  // Rows per role = max over columns of max(capacity, assigned), and at least
  // one row so a role always shows even where no team wants anyone in it.
  const rowsPerRole = {} as Record<BandRole, number>;
  const columnNames = ordered.map(namesByRole);
  for (const role of allRoles) {
    let max = 1;
    ordered.forEach((set, i) => {
      // A set whose team doesn't have this role contributes nothing.
      const cap = resolveTeamCapacities(catalogFor(set), set.slotCapacities)[role.key] ?? 0;
      max = Math.max(max, cap, columnNames[i][role.key].length);
    });
    rowsPerRole[role.key] = max;
  }

  const roleRows: GridRoleRow[] = allRoles.flatMap((role) =>
    Array.from({ length: rowsPerRole[role.key] }, (_, slot) => ({
      role: role.key,
      label: role.label,
      slot,
    }))
  );

  const columns: GridColumn[] = ordered.map((set, i) => {
    const z = zoned(set.startsAt, timeZone);
    // Pad each role's names out to its row count so cell lookups are total.
    const cells = {} as Record<BandRole, string[]>;
    for (const role of allRoles) {
      const names = columnNames[i][role.key];
      cells[role.key] = Array.from(
        { length: rowsPerRole[role.key] },
        (_, slot) => names[slot] ?? ""
      );
    }
    return {
      setId: set.id,
      dateKey: `${z.year}-${z.month.padStart(2, "0")}-${z.day.padStart(2, "0")}`,
      dateLabel: `${z.weekday} ${z.month}/${z.day}`,
      timeLabel: z.time,
      memo: [set.label?.trim(), set.notes?.trim()].filter(Boolean).join(" — "),
      cells,
    };
  });

  return { columns, roleRows };
}
