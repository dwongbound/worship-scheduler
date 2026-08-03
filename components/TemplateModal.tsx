"use client";
// Admin-only "add a weekly set time" form (Create tab). It's the same form as
// the calendar's ad-hoc CreateSetModal — via the shared SetFormFields — but
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
import { timeStringToMinutes } from "@/lib/dates";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import type { ApiTeam } from "@/lib/types";

export default function TemplateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
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

  // Reset each time the modal opens. Teams are fetched on the first open per
  // admin org (they rarely change) and the picker defaults to the first one.
  // Deps are [open] on purpose: adding `teams` would re-run this after the
  // fetch lands and wipe whatever the admin already typed.
  useEffect(() => {
    if (!open || !adminOrgId) return;
    setDays([]);
    const cached = teamsOrg === adminOrgId;
    setForm({ ...emptySetForm(), teamId: cached ? teams[0]?.id ?? "" : "" });
    if (!cached) {
      fetchJsonArray<ApiTeam>(`/api/teams?orgId=${adminOrgId}`).then((ts) => {
        setTeams(ts);
        setTeamsOrg(adminOrgId);
        setForm((f) => (f.teamId ? f : { ...f, teamId: ts[0]?.id ?? "" }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adminOrgId]);

  if (!open) return null;

  function toggleDay(day: number) {
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
      await Promise.all(
        days.map((dayOfWeek) =>
          fetch("/api/admin/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
            body: JSON.stringify({ ...shared, dayOfWeek }),
          })
        )
      );
      await onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add weekly set time">
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
                Days of week
              </legend>
              {/* Multi-select: a template is created for each checked day. */}
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
            {busy ? <LoadingDots size="sm" /> : "Add template"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
