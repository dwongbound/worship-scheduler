"use client";
// Export dialog opened from the calendar's "Export" button. Pick how far ahead
// to include, then download the currently-filtered sets as a calendar (.ics)
// feed or an Excel "master schedule" grid. The `sets` prop is already the
// calendar's on-screen selection (its team/person/status filters applied), so
// here we only add the look-ahead range on top.
import { useMemo, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import Select from "@/components/common/Select";
import type { ApiSet } from "@/lib/types";

type Unit = "weeks" | "months";
type Format = "ics" | "xlsx";

// now + `amount` of `unit`, as a timestamp cutoff for the look-ahead window.
function cutoffFrom(amount: number, unit: Unit): number {
  const d = new Date();
  if (unit === "weeks") d.setDate(d.getDate() + amount * 7);
  else d.setMonth(d.getMonth() + amount);
  return d.getTime();
}

export default function ExportModal({
  open,
  onClose,
  sets,
}: {
  open: boolean;
  onClose: () => void;
  sets: ApiSet[];
}) {
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<Unit>("months");
  // Which button is mid-download (disables both, shows its own spinner label).
  const [busy, setBusy] = useState<Format | null>(null);

  // The sets that fall inside [now, cutoff]. Past sets are dropped — an export
  // is always forward-looking.
  const selected = useMemo(() => {
    const now = Date.now();
    const cutoff = cutoffFrom(Math.max(1, amount), unit);
    return sets
      .filter((s) => {
        const t = new Date(s.startsAt).getTime();
        return t >= now && t <= cutoff;
      })
      .map((s) => s.id);
  }, [sets, amount, unit]);

  const download = async (format: Format) => {
    if (selected.length === 0) return;
    setBusy(format);
    try {
      const res = await fetch("/api/export/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, setIds: selected }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      // Stream the returned file to a temporary <a download> click.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "xlsx" ? "worship-schedule.xlsx" : "worship-schedule.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error(err);
      alert("Sorry — the export failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const none = selected.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export schedule"
      subtitle="Downloads the sets currently shown on your calendar."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => download("ics")}
            disabled={busy !== null || none}
          >
            {busy === "ics" ? "Preparing…" : "Calendar (.ics)"}
          </Button>
          <Button
            onClick={() => download("xlsx")}
            disabled={busy !== null || none}
          >
            {busy === "xlsx" ? "Preparing…" : "Excel"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Choose how far ahead to include, then pick a format.
        </p>
        <div className="flex items-end gap-3">
          <div className="w-28">
            <Input
              label="Include next"
              type="number"
              min={1}
              max={24}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="w-36">
            <Select
              label="Range"
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
            >
              <option value="weeks">weeks ahead</option>
              <option value="months">months ahead</option>
            </Select>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {none ? (
            <span className="text-amber-600 dark:text-amber-400">
              No upcoming sets in this range.
            </span>
          ) : (
            <>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {selected.length}
              </span>{" "}
              {selected.length === 1 ? "set" : "sets"} will be exported.
            </>
          )}
        </p>
      </div>
    </Modal>
  );
}
