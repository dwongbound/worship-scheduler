"use client";
// Admin-only "weekly set time" form (Create tab), used both to ADD new times
// and to EDIT an existing one (`template` set = edit mode). It's the same form
// as the calendar's ad-hoc CreateSetModal — via the shared SetFormFields — but
// recurring: instead of a fixed date it carries a day-of-week, and generating
// the schedule later expands it into concrete sets.
import { FormEvent, useEffect, useId, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import SetFormFields, { SetFormState, emptySetForm } from "./SetFormFields";
import TemplatePracticesEditor, {
  practicesPayload,
  toPracticeDrafts,
  type PracticeDraft,
} from "./TemplatePracticesEditor";
import { useOrgs } from "./OrgProvider";
import { DAY_INITIALS, DAY_LABELS } from "@/lib/constants";
import { minutesToTimeInput, timeStringToMinutes } from "@/lib/dates";
import { orgHeaders } from "@/lib/api";
import type { ApiSetTemplate, ApiTeam } from "@/lib/types";

export default function TemplateModal({
  open,
  template,
  teams,
  onClose,
  onCreated,
}: {
  open: boolean;
  // The row being edited, or null/undefined to add new ones.
  template?: ApiSetTemplate | null;
  // This admin org's teams, passed down rather than fetched: the Create page
  // already holds exactly this list (same endpoint, same org) for its own
  // sections, so asking for it again here was a second request for a list
  // sitting one component up. null while the page is still loading them.
  teams: ApiTeam[] | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { adminOrgId } = useOrgs();
  // The footer's submit button sits outside the <form>, so the two need a
  // shared id to find each other.
  const formId = useId();
  // Days this weekly time recurs on (0 = Sun … 6 = Sat). One template row is
  // created per checked day, so an admin can add e.g. Sun + Wed in one go.
  const [days, setDays] = useState<number[]>([]);
  const [form, setForm] = useState<SetFormState>(emptySetForm);
  // The practices every set generated from this time starts with. Its own
  // state rather than part of SetFormState, which CreateSetModal shares — a
  // practice on a concrete set is a date, not a weekday.
  const [practices, setPractices] = useState<PracticeDraft[]>([]);
  const [busy, setBusy] = useState(false);
  // Reset each time the modal opens — to the edited row's values, or to a
  // blank form, with the team picker defaulting to the first team.
  // Deps are [open, template] on purpose: adding `teams` would re-run this
  // when the page's list lands and wipe whatever the admin already typed.
  useEffect(() => {
    if (!open || !adminOrgId) return;
    setDays(template ? [template.dayOfWeek] : []);
    setPractices(toPracticeDrafts(template?.practices));
    setForm(
      template
        ? {
            label: template.label,
            startTime: minutesToTimeInput(template.startMinute),
            duration: template.durationMinutes,
            requiresMD: template.requiresMD,
            isPrivate: false, // templates have no private flag
            groupChatLeadDays: template.groupChatLeadDays,
            capacities: template.slotCapacities,
            teamId: template.teamId ?? "",
          }
        : { ...emptySetForm(), teamId: teams?.[0]?.id ?? "" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adminOrgId, template]);

  // The page's list can land after the modal is already open (first paint of
  // the Create tab). Fill the picker's default then — and only then, so it
  // never overwrites a team the admin has chosen.
  useEffect(() => {
    if (!open) return;
    setForm((f) => (f.teamId ? f : { ...f, teamId: teams?.[0]?.id ?? "" }));
  }, [open, teams]);

  if (!open) return null;

  function toggleDay(day: number) {
    // Editing touches ONE existing row, so picking a day MOVES it rather than
    // adding a second one; adding is multi-select (one row per checked day).
    if (template) {
      setDays([day]);
      return;
    }
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (days.length === 0) return;
    // The same validator the API runs. The editor already shows the sentence,
    // so this just stops a save that would 400.
    const payload = practicesPayload(practices);
    if ("error" in payload) return;

    setBusy(true);
    try {
      // One template row per checked day — the rest of the body is shared.
      const shared = {
        label: form.label,
        startMinute: timeStringToMinutes(form.startTime),
        durationMinutes: form.duration,
        requiresMD: form.requiresMD,
        groupChatLeadDays: form.groupChatLeadDays,
        // null capacities → the template uses the global default team shape.
        slotCapacities: form.capacities ?? undefined,
        teamId: form.teamId,
        // Always sent, even when empty: an empty list is how the last practice
        // is removed. (The API only leaves them alone when the field is absent
        // entirely, which is for callers that predate practices.)
        practices: payload.practices,
      };
      if (template) {
        // Edit: one row, one day. `slotCapacities: null` is sent explicitly so
        // turning a custom shape back off clears it (undefined would keep it).
        await fetch(`/api/admin/templates/${template.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...orgHeaders(adminOrgId),
          },
          body: JSON.stringify({
            ...shared,
            slotCapacities: form.capacities,
            dayOfWeek: days[0],
          }),
        });
      } else {
        // Every picked day in ONE request: the route creates them together, so
        // a failure can't leave half the days made (which the old POST-per-day
        // could, having already committed the ones before it).
        await fetch("/api/admin/templates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...orgHeaders(adminOrgId),
          },
          body: JSON.stringify({ ...shared, daysOfWeek: days }),
        });
      }
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={template ? "Edit weekly set time" : "Add weekly set time"}
      // In the footer rather than at the end of the form: Modal pins a footer
      // so it never scrolls away, and globals.css gives a phone's footer
      // buttons the full-width 44px row. The submit button is outside the
      // <form> as a result, so it names the form it submits.
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </Button>
          {/* Blocked until the teams list loads — every template needs a team. */}
          <Button
            form={formId}
            type="submit"
            loading={busy}
            disabled={!form.teamId || "error" in practicesPayload(practices)}
          >
            {template ? "Save changes" : "Add template"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <SetFormFields
          state={form}
          onChange={setForm}
          teams={teams ?? []}
          disabled={busy}
          labelRequired
          scheduleField={
            <fieldset disabled={busy}>
              <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {template ? "Day of week" : "Days of week"}
              </legend>
              {/* Seven across, one row. As full-word checkboxes these wrapped
                  into three ragged lines on a phone and took more height than
                  every other field put together; a week reads as a week when
                  its days sit side by side. The visible text is two letters
                  (DAY_INITIALS) and the full day name is the accessible one,
                  so this is still `getByRole("checkbox", { name: "Sunday" })`.
                  Adding is multi-select — a template is created for each
                  checked day. Editing is single-select: it moves the one row. */}
              <div className="grid grid-cols-7 gap-1">
                {DAY_LABELS.map((d, i) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={d}
                      title={d}
                      disabled={busy}
                      onClick={() => toggleDay(i)}
                      className={`flex h-11 items-center justify-center rounded-lg border
                        text-sm font-medium transition-colors disabled:cursor-not-allowed
                        disabled:opacity-60 sm:h-9 ${
                          on
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 " +
                              "dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                    >
                      {DAY_INITIALS[i]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          }
        />

        <TemplatePracticesEditor
          practices={practices}
          onChange={setPractices}
          disabled={busy}
        />
      </form>
    </Modal>
  );
}
