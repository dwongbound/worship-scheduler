"use client";
// The practices on ONE weekly set time (Create tab → Add/Edit weekly set time).
//
// A weekly time has no date, so neither can its practices: each row is a
// weekday and a window — "Wednesdays, 7 to 9" — read as the day in the SET's
// own Mon–Sun week, which is what puts a Wednesday practice before each Sunday
// service. lib/practices.ts owns that resolution and the validation; this is
// only the form.
//
// Deliberately NOT in SetFormFields, which is shared with the ad-hoc
// CreateSetModal: a practice on a concrete set is a DATE, not a weekday, so
// the two forms genuinely differ.
import Input from "./common/Input";
import Select from "./common/Select";
import { DAY_LABELS } from "@/lib/constants";
import { minutesToTimeInput, timeStringToMinutes } from "@/lib/dates";
import {
  MAX_PRACTICES_PER_SET,
  validateTemplatePractices,
  type TemplatePracticeSpec,
} from "@/lib/practices";

// A row as the form holds it: an id so React can key it while the day and
// times are still being typed (two blank rows are otherwise the same row).
export interface PracticeDraft extends TemplatePracticeSpec {
  localId: string;
}

/** A sensible first practice: the midweek evening most teams rehearse on. */
export function newPracticeDraft(): PracticeDraft {
  return {
    localId: crypto.randomUUID(),
    dayOfWeek: 3, // Wednesday
    startMinute: 19 * 60,
    endMinute: 21 * 60,
  };
}

export function toPracticeDrafts(
  practices: TemplatePracticeSpec[] | undefined
): PracticeDraft[] {
  return (practices ?? []).map((p) => ({ ...p, localId: crypto.randomUUID() }));
}

/**
 * What the save should send, or the sentence to show instead. Run through the
 * same validator the API uses, so the form can't offer a save the server will
 * refuse.
 */
export function practicesPayload(
  drafts: PracticeDraft[]
): { practices: TemplatePracticeSpec[] } | { error: string } {
  return validateTemplatePractices(
    drafts.map(({ dayOfWeek, startMinute, endMinute }) => ({
      dayOfWeek,
      startMinute,
      endMinute,
    }))
  );
}

export default function TemplatePracticesEditor({
  practices,
  onChange,
  disabled = false,
}: {
  practices: PracticeDraft[];
  onChange: (next: PracticeDraft[]) => void;
  disabled?: boolean;
}) {
  const patch = (localId: string, p: Partial<PracticeDraft>) =>
    onChange(practices.map((r) => (r.localId === localId ? { ...r, ...p } : r)));

  // The same check the save runs, shown as you type rather than on submit —
  // the usual case is an end time that hasn't caught up with a new start.
  const check = practicesPayload(practices);
  const error = "error" in check ? check.error : null;

  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Practices
      </legend>

      {practices.length === 0 ? (
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
          No practices. Add one and every set generated from this time gets it,
          with the whole roster invited.
        </p>
      ) : (
        <div className="mb-2 space-y-2">
          {practices.map((row) => (
            <div key={row.localId} className="flex flex-wrap items-end gap-2">
              {/* Leads the row rather than trailing it: the fields wrap on a
                  narrow screen, so a trailing ✕ ends up under whichever field
                  happened to wrap last and stops reading as "remove THIS row". */}
              <button
                type="button"
                aria-label="Remove practice"
                className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400
                  hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                onClick={() =>
                  onChange(practices.filter((r) => r.localId !== row.localId))
                }
              >
                <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden>
                  <path
                    d="M4 4l10 10M14 4L4 14"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
              <div className="w-36">
                <Select
                  label="Day"
                  hideLabel
                  // Test id rather than the label: getByLabel matches on a
                  // substring, and this form's own "Days of week" checkboxes
                  // would all answer to "Day".
                  data-testid="template-practice-day"
                  value={row.dayOfWeek}
                  onChange={(e) =>
                    patch(row.localId, { dayOfWeek: Number(e.target.value) })
                  }
                >
                  {DAY_LABELS.map((d, i) => (
                    <option key={i} value={i}>
                      {/* Plural — it recurs (e.g. "Wednesdays"). */}
                      {d}s
                    </option>
                  ))}
                </Select>
              </div>
              <span className="pb-2 text-sm text-gray-500 dark:text-gray-400">
                from
              </span>
              <div className="w-36 sm:w-28">
                <Input
                  label="Start time"
                  hideLabel
                  data-testid="template-practice-start"
                  type="time"
                  value={minutesToTimeInput(row.startMinute)}
                  onChange={(e) =>
                    patch(row.localId, {
                      startMinute: timeStringToMinutes(e.target.value),
                    })
                  }
                />
              </div>
              <span className="pb-2 text-sm text-gray-500 dark:text-gray-400">
                to
              </span>
              <div className="w-36 sm:w-28">
                <Input
                  label="End time"
                  hideLabel
                  data-testid="template-practice-end"
                  type="time"
                  value={minutesToTimeInput(row.endMinute)}
                  onChange={(e) =>
                    patch(row.localId, {
                      endMinute: timeStringToMinutes(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {/* The same full-width dashed add row the Create tab's weekly set times
          use, so "add another one of these" looks the same wherever it is. */}
      <button
        type="button"
        disabled={practices.length >= MAX_PRACTICES_PER_SET}
        onClick={() => onChange([...practices, newPracticeDraft()])}
        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-medium
          text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700
          disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600
          dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
      >
        + Add Practice
      </button>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        A practice is an extra calendar invite for everyone on the set. Changing
        these doesn&rsquo;t touch sets already generated — it lands on the next
        auto-schedule run.
      </p>
    </fieldset>
  );
}
