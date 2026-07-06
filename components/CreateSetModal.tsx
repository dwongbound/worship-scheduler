"use client";
// Admin-only "create a one-off set" form, opened from the calendar's inline
// "+" button on a day cell. Pre-fills the clicked date; the admin picks a
// time, duration, optional label, and (optionally) a custom team shape.
// Shares its body with the Create tab's TemplateModal via SetFormFields.
import { FormEvent, useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import SetFormFields, { SetFormState, emptySetForm } from "./SetFormFields";
import { formatDay, timeStringToMinutes } from "@/lib/dates";
import type { StagedPlan } from "@/lib/types";

export default function CreateSetModal({
  date,
  onClose,
  onCreated,
  onAutoSchedule,
}: {
  date: Date | null; // null = closed
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  // Hand a proposed (unsaved) team up to the calendar so it can open the
  // review modal. Called instead of creating the set directly.
  onAutoSchedule: (plan: StagedPlan) => void;
}) {
  const [form, setForm] = useState<SetFormState>(emptySetForm);
  // Which button is mid-request, so only that one spins ("auto" builds a
  // proposed team to review).
  const [busy, setBusy] = useState<"manual" | "auto" | null>(null);

  // Reset the form each time a new day is opened.
  useEffect(() => {
    if (date) setForm(emptySetForm());
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
    setBusy("manual");
    try {
      await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          startsAt: startsAtISO(),
          durationMinutes: form.duration,
          // null capacities → the set uses the global default team shape.
          slotCapacities: form.capacities ?? undefined,
        }),
      });
      await onCreated();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  // Ask the server to PROPOSE a team (spread away from neighboring days)
  // without saving anything, then open it in the review modal.
  async function autoSchedule() {
    setBusy("auto");
    try {
      const res = await fetch("/api/admin/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          startsAt: startsAtISO(),
          durationMinutes: form.duration,
          slotCapacities: form.capacities ?? undefined,
        }),
      });
      if (!res.ok) return; // leave the form open on a bad request
      const plan = (await res.json()) as StagedPlan;
      onClose();
      onAutoSchedule(plan);
    } finally {
      setBusy(null);
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
          disabled={!!busy}
          labelPlaceholder="e.g. Special Prayer Night"
        />

        {/* Auto schedule proposes a team (avoiding anyone serving the day
            before/after) that you review before anything is saved. */}
        <p className="pt-1 text-xs text-gray-500 dark:text-gray-400">
          &ldquo;Auto schedule&rdquo; proposes a full team, skipping people who
          serve on a neighboring day, for you to review before saving.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={!!busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={autoSchedule}
            disabled={!!busy}
          >
            {busy === "auto" ? <LoadingDots size="sm" /> : "Auto schedule"}
          </Button>
          <Button type="submit" disabled={!!busy}>
            {busy === "manual" ? <LoadingDots size="sm" /> : "Create set"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
