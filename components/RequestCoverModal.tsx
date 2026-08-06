"use client";
// Small modal shown when someone requests cover for one of their sets. Lets
// them leave an optional reason (e.g. "out of town") that teammates see next to
// the open cover request. Confirming hands the reason back to the caller, which
// PATCHes the assignment to SWAP_REQUESTED.
import { useEffect, useState } from "react";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";

export default function RequestCoverModal({
  open,
  onClose,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [reason, setReason] = useState("");

  // Start each request with an empty box (the modal is reused across sets).
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request cover"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? <LoadingDots size="sm" label="Requesting" /> : "Request cover"}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        This opens the set for any eligible teammate to take. Add a note so they
        know why you need cover (optional).
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional) — e.g. out of town this week"
        rows={3}
        aria-label="Reason for cover (optional)"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
      />
    </Modal>
  );
}
