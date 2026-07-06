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
import { DAY_LABELS } from "@/lib/constants";
import { timeStringToMinutes } from "@/lib/dates";

export default function TemplateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [dayOfWeek, setDayOfWeek] = useState(0); // Sunday
  const [form, setForm] = useState<SetFormState>(emptySetForm);
  const [busy, setBusy] = useState(false);

  // Reset each time the modal opens.
  useEffect(() => {
    if (open) {
      setDayOfWeek(0);
      setForm(emptySetForm());
    }
  }, [open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          dayOfWeek,
          startMinute: timeStringToMinutes(form.startTime),
          durationMinutes: form.duration,
          // null capacities → the template uses the global default team shape.
          slotCapacities: form.capacities ?? undefined,
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
          <Button type="submit" disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Add template"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
