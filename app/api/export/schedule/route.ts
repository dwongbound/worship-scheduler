// POST /api/export/schedule — export a chosen set of sets (the calendar's
// current filter + look-ahead range, sent as `setIds`) as either a personal-
// style .ics of every event or an .xlsx "master schedule" grid (roles down,
// service dates across). The client passes ids it already has on screen; we
// re-load them scoped to the caller's orgs + private-set rules, so ids the
// caller can't see are silently dropped.
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSessionUser } from "@/lib/auth";
import { resolveOrgScope } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { buildIcs } from "@/lib/ics";
import { buildScheduleGrid, type GridSet } from "@/lib/scheduleGrid";
import { INSTRUMENT_LABELS, type Instrument } from "@/lib/constants";

// Pastel fill cycled per service day (header shade + lighter body shade),
// echoing the hand-kept spreadsheet this replaces.
const DAY_COLORS = [
  { header: "FFD9BEE8", body: "FFEFE1F6" }, // purple
  { header: "FFB6D7A8", body: "FFD9EAD3" }, // green
  { header: "FFFFE599", body: "FFFFF2CC" }, // yellow
  { header: "FFA4C2F4", body: "FFCFE2F3" }, // blue
];
const THIN_BORDER = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
const ALL_BORDERS = {
  top: THIN_BORDER,
  left: THIN_BORDER,
  bottom: THIN_BORDER,
  right: THIN_BORDER,
};

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const format = body?.format === "xlsx" ? "xlsx" : "ics";
  const setIds: string[] = Array.isArray(body?.setIds)
    ? body.setIds.filter((id: unknown) => typeof id === "string")
    : [];
  if (setIds.length === 0) {
    return NextResponse.json({ error: "No sets selected" }, { status: 400 });
  }

  // Re-load the requested sets, scoped to what the caller may actually see:
  // their orgs, and (for private sets) only ones they're on or admin over.
  const scope = await resolveOrgScope(user.id, null);
  const sets = await prisma.set.findMany({
    where: {
      id: { in: setIds },
      orgId: { in: scope },
      OR: [
        { isPrivate: false },
        { assignments: { some: { userId: user.id } } },
        { org: { memberships: { some: { userId: user.id, isAdmin: true } } } },
      ],
    },
    orderBy: { startsAt: "asc" },
    include: {
      team: { select: { name: true } },
      assignments: {
        include: { user: { select: { name: true } } },
        orderBy: { role: "asc" },
      },
    },
  });

  if (format === "xlsx") {
    const buffer = await buildWorkbook(sets);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="worship-schedule.xlsx"',
      },
    });
  }

  // .ics: one event per set, its full roster in the description.
  const ics = buildIcs(
    sets.map((set) => ({
      id: set.id,
      title: set.label?.trim() || set.team?.name || "Worship Set",
      description: set.assignments
        .map((a) => `${INSTRUMENT_LABELS[a.role as Instrument]}: ${a.user.name}`)
        .join("\n"),
      start: set.startsAt,
      durationMinutes: set.durationMinutes,
    }))
  );
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="worship-schedule.ics"',
    },
  });
}

// Sets as loaded above → the styled .xlsx grid buffer.
type LoadedSet = {
  id: string;
  label: string | null;
  notes: string | null;
  startsAt: Date;
  slotCapacities: unknown;
  assignments: { role: string; user: { name: string } }[];
};

async function buildWorkbook(sets: LoadedSet[]): Promise<ArrayBuffer> {
  const grid = buildScheduleGrid(
    sets.map(
      (s): GridSet => ({
        id: s.id,
        label: s.label,
        notes: s.notes,
        startsAt: s.startsAt,
        slotCapacities: s.slotCapacities as GridSet["slotCapacities"],
        assignments: s.assignments.map((a) => ({
          role: a.role as Instrument,
          userName: a.user.name,
        })),
      })
    )
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedule");

  const DATE_ROW = 1;
  const TIME_ROW = 2;
  const MEMO_ROW = 3;
  const FIRST_ROLE_ROW = 4;

  // Column A = the row labels; each set gets a column starting at B (index 2).
  ws.getColumn(1).width = 18;
  ws.getCell(TIME_ROW, 1).value = "Time";
  ws.getCell(MEMO_ROW, 1).value = "Memo";
  grid.roleRows.forEach((r, i) => {
    ws.getCell(FIRST_ROLE_ROW + i, 1).value = r.label;
  });

  // A group index per column so same-day columns share a color; also used to
  // merge the date header across a day's columns below.
  const groupIndex: number[] = [];
  let groups = -1;
  grid.columns.forEach((col, i) => {
    if (i === 0 || col.dateKey !== grid.columns[i - 1].dateKey) groups++;
    groupIndex.push(groups);
  });

  grid.columns.forEach((col, ci) => {
    const c = ci + 2;
    ws.getColumn(c).width = 16;
    const color = DAY_COLORS[groupIndex[ci] % DAY_COLORS.length];

    ws.getCell(DATE_ROW, c).value = col.dateLabel;
    ws.getCell(TIME_ROW, c).value = col.timeLabel;
    ws.getCell(MEMO_ROW, c).value = col.memo;
    grid.roleRows.forEach((r, i) => {
      ws.getCell(FIRST_ROLE_ROW + i, c).value = col.cells[r.role][r.slot] || "";
    });

    // Fill the whole column: header shade for the date row, body shade below.
    const lastRow = FIRST_ROLE_ROW + grid.roleRows.length - 1;
    for (let row = DATE_ROW; row <= lastRow; row++) {
      const cell = ws.getCell(row, c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: row === DATE_ROW ? color.header : color.body },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
  });

  // Merge each day's date-header cells into one banner.
  let start = 0;
  for (let i = 1; i <= grid.columns.length; i++) {
    const end = i === grid.columns.length || groupIndex[i] !== groupIndex[start];
    if (end) {
      if (i - 1 > start) ws.mergeCells(DATE_ROW, start + 2, DATE_ROW, i + 1);
      start = i;
    }
  }

  // Borders everywhere + bold the date banner and the label column.
  const lastRow = FIRST_ROLE_ROW + grid.roleRows.length - 1;
  const lastCol = grid.columns.length + 1;
  for (let row = DATE_ROW; row <= lastRow; row++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(row, c);
      cell.border = ALL_BORDERS;
      if (c === 1) {
        cell.font = { bold: true };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      if (row === DATE_ROW) cell.font = { bold: true };
    }
  }

  // Keep the labels + top header rows in view while scrolling a long schedule.
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: MEMO_ROW }];

  // exceljs's writeBuffer resolves to an ArrayBuffer-like value; NextResponse
  // accepts it directly as the response body.
  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}
