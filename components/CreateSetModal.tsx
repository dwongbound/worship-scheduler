"use client";
// Admin-only "create a one-off set" form, opened from the calendar's inline
// "+" button on a day cell. Pre-fills the clicked date; the admin picks a
// time, duration, optional label, and (optionally) a custom team shape.
// The set is created empty — to staff it, open it and use "Auto schedule"
// (or assign people by hand) in the set detail modal.
// Shares its body with the Create tab's TemplateModal via SetFormFields.
import { FormEvent, useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import SetFormFields, { SetFormState, emptySetForm } from "./SetFormFields";
import { useOrgs } from "./OrgProvider";
import { formatDay, timeStringToMinutes } from "@/lib/dates";
import { fetchJsonArray } from "@/lib/api";
import type { ApiTeam } from "@/lib/types";

export default function CreateSetModal({
  date,
  onClose,
  onCreated,
}: {
  date: Date | null; // null = closed
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { orgs, isAdminOf } = useOrgs();
  const [form, setForm] = useState<SetFormState>(emptySetForm);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<ApiTeam[]>([]);

  // Reset the form each time a new day is opened. Teams are fetched only on
  // the first open (they rarely change) and the picker defaults to the first.
  // Only teams from orgs I ADMIN are offered (the server rejects the rest);
  // when I admin several orgs, team names are suffixed with the org name.
  // Deps are [date] on purpose: adding `teams` would re-run this after the
  // fetch lands and wipe whatever the admin already typed.
  useEffect(() => {
    if (!date) return;
    setForm({ ...emptySetForm(), teamId: teams[0]?.id ?? "" });
    if (teams.length === 0) {
      fetchJsonArray<ApiTeam>("/api/teams").then((all) => {
        const mine = all.filter((t) => isAdminOf(t.orgId));
        const multiOrg = new Set(mine.map((t) => t.orgId)).size > 1;
        const ts = multiOrg
          ? mine.map((t) => ({
              ...t,
              name: `${t.name} (${orgs?.find((o) => o.id === t.orgId)?.name ?? "?"})`,
            }))
          : mine;
        setTeams(ts);
        setForm((f) => (f.teamId ? f : { ...f, teamId: ts[0]?.id ?? "" }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (!date) return null;

  // Combine the clicked day with the chosen time into a local Date, then
  // return it as the ISO instant the server stores directly.
  function startsAtISO(): string {
    const minutes = timeStringToMinutes(form.startTime);
    return new Date(
      date!.getFullYear(),
      date!.getMonth(),
      date!.getDate(),
      Math.floor(minutes / 60),
      minutes % 60
    ).toISOString();
  }

  // Create the set immediately, with no team.
  async function createSet() {
    setBusy(true);
    try {
      await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          startsAt: startsAtISO(),
          durationMinutes: form.duration,
          requiresMD: form.requiresMD,
          // null capacities → the set uses the global default team shape.
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    createSet();
  };

  return (
    <Modal open onClose={onClose} title="New set">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {formatDay(date)}
      </p>

      <form onSubmit={submit} className="space-y-3">
        <SetFormFields
          state={form}
          onChange={setForm}
          teams={teams}
          disabled={busy}
          labelPlaceholder="e.g. Special Prayer Night"
        />

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {/* Blocked until the teams list loads — every set needs a team. */}
          <Button type="submit" disabled={busy || !form.teamId}>
            {busy ? <LoadingDots size="sm" /> : "Create set"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
