// Practices (rehearsals) on a set — the pure rules, unit-tested in
// tests/unit/practices.test.ts.
//
// A practice is an extra calendar event for the people already on a set. What
// it deliberately is NOT:
//
//   - it is not on the app calendar (it lives under its set, nowhere else);
//   - it is not a booking, so `buildSchedule` never sees one — load, spacing
//     and availability are decided by sets alone (see the note on
//     `PRACTICES_ARE_NOT_BOOKINGS` below);
//   - it has no roster of its own. Who is invited is DERIVED from the set's
//     assignments at send time, so a roster change moves the practice invite
//     with it and nobody can be on a practice without being on the set;
//   - it has no duration. A practice is a START and an END, because that is
//     how an admin says it ("Wednesday, 7 to 9") and what the calendar event
//     needs. Sets carry `durationMinutes` for historical reasons; practices
//     don't inherit that.
//
// On a SetTemplate a practice is a WEEKDAY and a time window rather than a
// date, a weekly set time having no date of its own. The weekday means "the
// one in the same week as the set" — see `practiceWeekStart`.

/**
 * A reminder in code, not a switch: nothing in this module is wired into
 * `lib/scheduler.ts`, and nothing should be. Practices are invisible to auto
 * schedule by construction — there is no practice-aware branch to forget to
 * turn on, because the scheduler is never handed practices at all.
 */
export const PRACTICES_ARE_NOT_BOOKINGS = true;

/**
 * How many practices one set (or one template) may carry. Dylan asked for
 * "unlimited", and nothing here needs a cap to be correct — but each practice
 * is a real calendar event mailed to the whole roster, so a fat-fingered
 * repeat shouldn't be able to send fifty. High enough to never be met by
 * someone using the feature as intended.
 */
export const MAX_PRACTICES_PER_SET = 20;

/** Shortest and longest a practice may run. */
export const MIN_PRACTICE_MINUTES = 15;
export const MAX_PRACTICE_MINUTES = 12 * 60;

const MINUTES_IN_DAY = 24 * 60;

/**
 * One practice on a weekly template: a weekday and a window, resolved against
 * each set the template expands into.
 */
export interface TemplatePracticeSpec {
  /** 0 = Sunday … 6 = Saturday, read within the set's own Mon–Sun week. */
  dayOfWeek: number;
  /** Minutes from midnight, e.g. 19:00 = 1140. */
  startMinute: number;
  /** Minutes from midnight; always after `startMinute`. */
  endMinute: number;
}

/** One practice on a concrete set: two instants, no length. */
export interface PracticeSpec {
  startsAt: Date;
  endsAt: Date;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * The MONDAY of the week a set falls in, at local midnight.
 *
 * This is the whole meaning of "the Wednesday" on a weekly template: the one
 * in the same week as the set. Weeks run Mon–Sun, matching `weekKey` in
 * lib/schedulingRules.ts — and that choice is what makes a rehearsal a
 * rehearsal, since under a Mon–Sun week every weekday from Monday to Saturday
 * lands BEFORE a Sunday service rather than after it.
 */
export function practiceWeekStart(setStartsAt: Date): Date {
  const d = new Date(setStartsAt);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. Sunday is the LAST day of a Mon–Sun week, so it is
  // six days past that week's Monday, not zero.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

/**
 * When a template practice actually happens for a given set.
 *
 * Day math uses the local getters, like `occurrencesInRange` — the server's TZ
 * is pinned (`instrumentation.ts` from `APP_TZ`) and generated set times are
 * built the same way, so a practice lands on the wall clock the admin typed
 * even across a DST boundary between it and its set.
 */
export function practiceDates(
  setStartsAt: Date,
  spec: TemplatePracticeSpec
): PracticeSpec {
  const monday = practiceWeekStart(setStartsAt);
  // Monday is index 0 in a Mon–Sun week; Sunday (getDay 0) is index 6.
  const offset = (spec.dayOfWeek + 6) % 7;

  const startsAt = new Date(monday);
  startsAt.setDate(monday.getDate() + offset);
  startsAt.setMinutes(spec.startMinute); // JS normalizes 450 min → 07:30

  const endsAt = new Date(monday);
  endsAt.setDate(monday.getDate() + offset);
  endsAt.setMinutes(spec.endMinute);

  return { startsAt, endsAt };
}

/**
 * A template's practices as concrete ones for a set it expanded into, in time
 * order. This is what the generate step writes onto each new set.
 */
export function practicesForSet(
  setStartsAt: Date,
  specs: TemplatePracticeSpec[]
): PracticeSpec[] {
  return specs
    .map((spec) => practiceDates(setStartsAt, spec))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** How long a practice runs, for the places that want to say "2 hr". */
export function practiceMinutes(practice: PracticeSpec): number {
  return Math.round((practice.endsAt.getTime() - practice.startsAt.getTime()) / 60_000);
}

/** The window check both validators share: a real span, of a sane length. */
function windowError(startMinute: number, endMinute: number): string | null {
  if (endMinute <= startMinute) {
    return "A practice has to end after it starts.";
  }
  const span = endMinute - startMinute;
  if (span < MIN_PRACTICE_MINUTES) {
    return `A practice has to run at least ${MIN_PRACTICE_MINUTES} minutes.`;
  }
  if (span > MAX_PRACTICE_MINUTES) {
    return `A practice can't run longer than ${MAX_PRACTICE_MINUTES / 60} hours.`;
  }
  return null;
}

/**
 * Validate and normalize what a client sent as a template's practice list.
 * Returns the cleaned list, or an `error` sentence fit to show an admin.
 *
 * Duplicates (same weekday AND same start) are DROPPED rather than refused:
 * two practices at one instant would be two identical calendar events, and
 * silently keeping one is what the admin plainly meant. Everything else — a
 * bad shape, an end before the start, a count past the cap — is an error,
 * because guessing at it would send the wrong invite.
 */
export function validateTemplatePractices(
  raw: unknown
): { practices: TemplatePracticeSpec[] } | { error: string } {
  if (raw === null || raw === undefined) return { practices: [] };
  if (!Array.isArray(raw)) return { error: "Practices must be a list." };

  const practices: TemplatePracticeSpec[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each practice needs a day, a start time and an end time." };
    }
    const { dayOfWeek, startMinute, endMinute } = entry as Record<string, unknown>;

    if (!isInt(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { error: "A practice needs a day of the week." };
    }
    if (
      !isInt(startMinute) ||
      startMinute < 0 ||
      startMinute >= MINUTES_IN_DAY ||
      !isInt(endMinute) ||
      endMinute <= 0 ||
      endMinute > MINUTES_IN_DAY
    ) {
      return { error: "A practice needs a start time and an end time." };
    }
    const bad = windowError(startMinute, endMinute);
    if (bad) return { error: bad };

    const key = `${dayOfWeek}:${startMinute}`;
    if (seen.has(key)) continue; // the same practice twice — keep one
    seen.add(key);
    practices.push({ dayOfWeek, startMinute, endMinute });
  }

  if (practices.length > MAX_PRACTICES_PER_SET) {
    return { error: `A set can have at most ${MAX_PRACTICES_PER_SET} practices.` };
  }

  // Mon–Sun order, so the list reads in the order the practices happen —
  // the same week the set is in.
  return {
    practices: practices.sort(
      (a, b) =>
        ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) || a.startMinute - b.startMinute
    ),
  };
}

/**
 * Validate one ad-hoc practice being added to a concrete set — any date, which
 * is the point: a practice can be dropped on a set nowhere near the template's
 * weekday, before or after the set itself.
 *
 * `existing` is the set's current practice start times, which is how the cap
 * and the same-instant clash are caught HERE with a sentence of their own,
 * rather than as a `@@unique([setId, startsAt])` violation the route would
 * have to guess the meaning of.
 */
export function validateSetPractice(
  raw: unknown,
  existing: Date[] = []
): { practice: PracticeSpec } | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "A practice needs a date, a start time and an end time." };
  }
  const { startsAt, endsAt } = raw as Record<string, unknown>;

  const when = (value: unknown): Date | null => {
    const d =
      value instanceof Date
        ? value
        : typeof value === "string" || typeof value === "number"
          ? new Date(value)
          : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const start = when(startsAt);
  const end = when(endsAt);
  if (!start || !end) {
    return { error: "A practice needs a date, a start time and an end time." };
  }

  // Minutes from midnight of the START day on both ends, so a window that runs
  // past midnight is measured as the span it really is rather than wrapping.
  const span = Math.round((end.getTime() - start.getTime()) / 60_000);
  const bad = windowError(0, span);
  if (bad) return { error: bad };

  if (existing.some((d) => d.getTime() === start.getTime())) {
    return { error: "There's already a practice at that time on this set." };
  }
  if (existing.length >= MAX_PRACTICES_PER_SET) {
    return { error: `A set can have at most ${MAX_PRACTICES_PER_SET} practices.` };
  }

  return { practice: { startsAt: start, endsAt: end } };
}

/**
 * The badge after a recurring set's time in the Create tab's list: "+2" for a
 * template with two practices, null for one with none (so the cell stays the
 * bare time it has always been).
 */
export function practiceCountBadge(count: number): string | null {
  return count > 0 ? `+${count}` : null;
}

/**
 * How a template practice reads in the editor and in that badge's tooltip —
 * "Wednesdays, 7PM–9PM". The day and time labels are injected rather than
 * imported so this module stays free of formatting (and so the caller passes
 * the app's own `DAY_LABELS` and `minutesToShortTimeLabel`).
 */
export function describeTemplatePractice(
  spec: TemplatePracticeSpec,
  dayLabel: (dayOfWeek: number) => string,
  timeLabel: (minutes: number) => string
): string {
  return `${dayLabel(spec.dayOfWeek)}s, ${timeLabel(spec.startMinute)}–${timeLabel(
    spec.endMinute
  )}`;
}

/**
 * Who, of a set's roster, is free for one of its practices — and when they
 * aren't, which of their own blocks says so.
 *
 * `blocks` is injected, and the ONLY thing passed in is `isUserAvailable`: the
 * free/busy answer the modal shows has to be the same answer the scheduler
 * would give, so this doesn't re-implement the rule matching. Each rule is
 * tried ALONE — a rule that makes someone unavailable by itself is a reason
 * worth naming — which is the same leave-one-out trick `ruleHeldRoles` uses,
 * and it can't drift from the real verdict.
 *
 * A practice is turned into a set-shaped window for that call; its length is
 * the span between its two instants. That synthetic set is never stored and
 * never reaches the scheduler — practices are not bookings.
 */
export function practiceFreeBusy<R>(
  roster: { userId: string }[],
  practice: PracticeSpec & { id?: string },
  rules: R[],
  blocks: (
    userId: string,
    window: { id: string; startsAt: Date; durationMinutes: number },
    rules: R[]
  ) => boolean
): { userId: string; free: boolean; blockedBy: R[] }[] {
  const window = {
    // `isUserAvailable` takes a set-shaped thing, and a set has an id. Nothing
    // reads it, but passing the practice's keeps a stray log honest.
    id: practice.id ?? "practice",
    startsAt: practice.startsAt,
    durationMinutes: practiceMinutes(practice),
  };
  // One row per person, however many seats they hold on the set.
  const userIds = [...new Set(roster.map((r) => r.userId))];

  return userIds.map((userId) => {
    const free = blocks(userId, window, rules);
    return {
      userId,
      free,
      blockedBy: free ? [] : rules.filter((rule) => !blocks(userId, window, [rule])),
    };
  });
}
