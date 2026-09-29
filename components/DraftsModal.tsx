"use client";

// The Drafts list: every saved generate preview for one org, newest activity
// first, each row openable or deletable.
//
// Deleting stays INSIDE this modal on purpose — you delete a draft to make room
// for another one, so being thrown back to the page would mean reopening the
// list to carry on. The confirm is a second modal stacked over this one.
import { useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import { draftLabel, MAX_DRAFTS, type DraftSummary } from "@/lib/drafts";

// "3 Feb, 2:05 PM" — drafts are short-lived working state, so the date is
// written out rather than shown as a bare timestamp.
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DraftsModal({
  open,
  drafts,
  busyId,
  onOpenDraft,
  onDelete,
  onClose,
}: {
  open: boolean;
  drafts: DraftSummary[];
  // The draft currently being opened or deleted, so its row can show progress.
  busyId?: string | null;
  onOpenDraft: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  // Which draft the trash icon is asking about. Held by id rather than a bare
  // boolean so the confirm can name what it's about to destroy.
  const [confirming, setConfirming] = useState<DraftSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const kept = drafts.filter((d) => !d.isRecovery).length;

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await onDelete(confirming.id);
      setConfirming(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Drafts"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {kept} of {MAX_DRAFTS} saved
          {drafts.length > kept && " · plus an autosaved preview"}
        </p>

        {drafts.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No drafts yet. Save one from a generated preview.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-center gap-3 py-2.5"
              >
                {/* min-w-0 so a long name truncates instead of shoving the
                    actions off the right edge. */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {draftLabel(draft)}
                  </p>
                  {/* Created, last written to, and who first saved it. Says
                      "last saved" rather than "edited" because the autosave
                      moves this too — nobody need have touched the plan by
                      hand. Dropped when it matches the creation time, since an
                      identical pair of timestamps is noise. */}
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Created {when(draft.createdAt)} by {draft.createdByName}
                    {draft.updatedAt !== draft.createdAt &&
                      ` · last saved ${when(draft.updatedAt)}`}
                  </p>
                </div>
                {/* Actions ride hard right, in a fixed order, so they land in
                    the same place on every row. */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Delete ${draftLabel(draft)}`}
                    title="Delete draft"
                    onClick={() => setConfirming(draft)}
                    disabled={!!busyId}
                    // Coloured at rest, not only on hover: the two actions sit
                    // side by side and the icons alone are what tells them
                    // apart, so destructive-red vs brand-blue has to be legible
                    // before the pointer arrives.
                    className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Open ${draftLabel(draft)}`}
                    title="Open draft"
                    onClick={() => onOpenDraft(draft.id)}
                    disabled={!!busyId}
                    className="rounded p-1.5 text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                  >
                    {busyId === draft.id ? <LoadingDots size="sm" /> : <OpenIcon />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Stacked over the list, which stays open behind it. */}
      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Delete this draft?"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirming(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <LoadingDots size="sm" /> : "Delete"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium">{confirming && draftLabel(confirming)}</span>{" "}
          will be deleted permanently. This can&apos;t be undone.
        </p>
      </Modal>
    </>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

// An arrow leaving a box — "open this one up", distinct from the trash beside it.
function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}
