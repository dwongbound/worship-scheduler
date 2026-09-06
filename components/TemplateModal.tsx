"use client";
// Admin-only "weekly set time" form (Create tab), used both to ADD new times
// and to EDIT an existing one (`template` set = edit mode). It's the same form
// as the calendar's ad-hoc CreateSetModal — via the shared SetFormFields — but
// recurring: instead of a fixed date it carries a day-of-week, and generating
// the schedule later expands it into concrete sets.
import { FormEvent, useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Checkbox from "./common/Checkbox";
import LoadingDots from "./common/LoadingDots";
import SetFormFields, { SetFormState, emptySetForm } from "./SetFormFields";
import { useOrgs } from "./OrgProvider";
import { DAY_LABELS } from "@/lib/constants";
import { minutesToTimeInput, timeStringToMinutes } from "@/lib/dates";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import type { ApiSetTemplate, ApiTeam } from "@/lib/types";

export default function TemplateModal({
  open,
  template,
  onClose,
  onCreated,
}: {
  open: boolean;
  // The row being edited, or null/undefined to add new ones.
  template?: ApiSetTemplate | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { adminOrgId } = useOrgs();
  // Days this weekly time recurs on (0 = Sun … 6 = Sat). One template row is
  // created per checked day, so an admin can add e.g. Sun + Wed in one go.
  const [days, setDays] = useState<number[]>([]);
  const [form, setForm] = useState<SetFormState>(emptySetForm);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  // Which org the cached team list belongs to (refetched after an org switch).
  const [teamsOrg, setTeamsOrg] = useState("");

  // Reset each time the modal opens — to the edited row's values, or to a
  // blank form. Teams are fetched on the first open per admin org (they rarely
  // change) and the picker defaults to the first one.
  // Deps are [open, template] on purpose: adding `teams` would re-run this
  // after the fetch lands and wipe whatever the admin already typed.
  useEffect(() => {
    if (!open || !adminOrgId) return;
    setDays(template ? [template.dayOfWeek] : []);
    const cached = teamsOrg === adminOrgId;
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
        : { ...emptySetForm(), teamId: cached ? teams[0]?.id ?? "" : "" }
    );
    if (!cached) {
      fetchJsonArray<ApiTeam>(`/api/teams?orgId=${adminOrgId}`).then((ts) => {
        setTeams(ts);
        setTeamsOrg(adminOrgId);
        setForm((f) => (f.teamId ? f : { ...f, teamId: ts[0]?.id ?? "" }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adminOrgId, template]);

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
    >
      <form onSubmit={submit} className="space-y-3">
        <SetFormFields
          state={form}
          onChange={setForm}
          teams={teams}
          disabled={busy}
          labelRequired
          scheduleField={
            <fieldset disabled={busy}>
              <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {template ? "Day of week" : "Days of week"}
              </legend>
              {/* Adding is multi-select — a template is created for each
                  checked day. Editing is single-select: it moves the one row. */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {DAY_LABELS.map((d, i) => (
                  <Checkbox
                    key={i}
                    label={d}
                    checked={days.includes(i)}
                    onChange={() => toggleDay(i)}
                    disabled={busy}
                  />
                ))}
              </div>
            </fieldset>
          }
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {/* Blocked until the teams list loads — every template needs a team. */}
          <Button type="submit" disabled={busy || !form.teamId}>
            {busy ? (
              <LoadingDots size="sm" />
            ) : template ? (
              "Save changes"
            ) : (
              "Add template"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
