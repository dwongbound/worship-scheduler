import { describe, it, expect } from "vitest";
import { buildScheduleGrid, type GridSet } from "@/lib/scheduleGrid";

// Fixed timezone so date/time labels are deterministic regardless of the host.
const TZ = "America/Los_Angeles";

function set(partial: Partial<GridSet> & Pick<GridSet, "id" | "startsAt">): GridSet {
  return {
    label: null,
    notes: null,
    slotCapacities: null,
    assignments: [],
    ...partial,
  };
}

describe("buildScheduleGrid", () => {
  it("orders columns chronologically and labels date/time in the app tz", () => {
    const grid = buildScheduleGrid(
      [
        set({ id: "b", startsAt: new Date("2026-08-04T19:00:00-07:00") }),
        set({ id: "a", startsAt: new Date("2026-08-04T14:00:00-07:00") }),
      ],
      TZ
    );
    expect(grid.columns.map((c) => c.setId)).toEqual(["a", "b"]);
    expect(grid.columns[0].dateLabel).toBe("Tuesday 8/4");
    expect(grid.columns[0].timeLabel).toBe("2:00 PM");
    expect(grid.columns[1].timeLabel).toBe("7:00 PM");
  });

  it("gives same-day columns a shared dateKey for merging", () => {
    const grid = buildScheduleGrid(
      [
        set({ id: "a", startsAt: new Date("2026-08-04T14:00:00-07:00") }),
        set({ id: "b", startsAt: new Date("2026-08-06T14:00:00-07:00") }),
      ],
      TZ
    );
    expect(grid.columns[0].dateKey).toBe("2026-08-04");
    expect(grid.columns[1].dateKey).toBe("2026-08-06");
    expect(grid.columns[0].dateKey).not.toBe(grid.columns[1].dateKey);
  });

  it("places each assignment in its role's slot rows", () => {
    const grid = buildScheduleGrid(
      [
        set({
          id: "a",
          startsAt: new Date("2026-08-04T14:00:00-07:00"),
          assignments: [
            { role: "WORSHIP_LEADER", userName: "Alex" },
            { role: "VOCALS", userName: "Judy" },
          ],
        }),
      ],
      TZ
    );
    const wlRows = grid.roleRows.filter((r) => r.role === "WORSHIP_LEADER");
    const voxRows = grid.roleRows.filter((r) => r.role === "VOCALS");
    expect(wlRows).toHaveLength(1);
    // Vox default capacity is 2, so two rows even with one person assigned —
    // the unfilled slot still gets a row.
    expect(voxRows).toHaveLength(2);
    const cells = grid.columns[0].cells;
    expect(cells.WORSHIP_LEADER[0]).toBe("Alex");
    expect(cells.VOCALS).toEqual(["Judy", ""]);
  });

  it("grows a role's rows when a set over-assigns past capacity", () => {
    const grid = buildScheduleGrid(
      [
        set({
          id: "a",
          startsAt: new Date("2026-08-04T14:00:00-07:00"),
          // Worship leader capacity is 1; two people forces a second row.
          assignments: [
            { role: "WORSHIP_LEADER", userName: "Alex" },
            { role: "WORSHIP_LEADER", userName: "Joe" },
          ],
        }),
      ],
      TZ
    );
    const wlRows = grid.roleRows.filter((r) => r.role === "WORSHIP_LEADER");
    expect(wlRows).toHaveLength(2);
    expect(grid.columns[0].cells.WORSHIP_LEADER).toEqual(["Alex", "Joe"]);
  });

  it("joins label and notes into the memo line", () => {
    const grid = buildScheduleGrid(
      [
        set({
          id: "a",
          startsAt: new Date("2026-08-04T14:00:00-07:00"),
          label: "Kingdom Come",
          notes: "P Joe Lee",
        }),
      ],
      TZ
    );
    expect(grid.columns[0].memo).toBe("Kingdom Come — P Joe Lee");
  });
});
