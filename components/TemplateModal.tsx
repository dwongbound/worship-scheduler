"use client";
// Admin-only "add a weekly set time" form (Create tab). It's the same form as
// the calendar's ad-hoc CreateSetModal — via the shared SetFormFields — but
// recurring: instead of a fixed date it carries a day-of-week, and generating
// the schedule later expands it into concrete sets.
import { FormEvent, useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Select from "./common/Select";
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
  const [dayOfWeek, setDayOfWeek] = useState(0); // Sunday
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
    setDayOfWeek(0);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({
          label: form.label,
          dayOfWeek,
          startMinute: timeStringToMinutes(form.startTime),
          durationMinutes: form.duration,
          requiresMD: form.requiresMD,
          // null capacities → the template uses the global default team shape.
          slotCapacities: form.capacities ?? undefined,
          teamId: form.teamId,
        }),
      });
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
            <Select
              label="Day of week"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              disabled={busy}
            >
              {DAY_LABELS.map((d, i) => (
                <option key={i} value={i}>
                  Every {d}
                </option>
              ))}
            </Select>
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
