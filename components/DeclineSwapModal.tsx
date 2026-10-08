"use client";
// Shown when someone declines a targeted swap. The note is OPTIONAL — the
// point of the modal is that a decline arriving with no explanation reads
// colder than it's meant to, not that an explanation is owed. Whatever they
// type leads the proposer's "swap declined" DM; leaving it blank just omits
// that sentence.
//
// Deliberately the same shape as RequestCoverModal: both are "confirm this,
// and say why if you like", and a second layout for the same job would make
// the pair look like different kinds of decision.
import { useEffect, useState } from "react";
import Button from "./common/Button";
import InfoTooltip from "./common/InfoTooltip";
import Modal from "./common/Modal";

export default function DeclineSwapModal({
  open,
  onClose,
  onConfirm,
  busy = false,
  /** Who proposed the trade — so the note's reader is named, not abstract. */
  proposer,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void | Promise<void>;
  busy?: boolean;
  proposer?: string;
}) {
  const [note, setNote] = useState("");

  // Start each decline with an empty box (the modal is reused across swaps).
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  return (
    <Modal
      open={open}
      // Sealed while the POST is in flight: ✕, Escape and the backdrop all
      // land here, and closing mid-request would take the dots away with it.
      onClose={busy ? () => {} : onClose}
      title="Decline this swap"
      titleAccessory={
        <InfoTooltip
          side="bottom"
          text="Both slots stay exactly as they are. Your note (optional) is sent to whoever proposed the trade."
        />
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => onConfirm(note)} loading={busy}>
            Decline
          </Button>
        </div>
      }
    >
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={
          proposer
            ? `Note for ${proposer} (optional) — e.g. I'm away that week`
            : "Note (optional) — e.g. I'm away that week"
        }
        rows={3}
        aria-label="Reason for declining (optional)"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
      />
    </Modal>
  );
}
