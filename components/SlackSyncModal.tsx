"use client";
// "Sync team members" (Org settings → Slack workspace). Walks the whole org,
// looking each person up in Slack by their email address and caching the member
// id that comes back, so the bot can DM them without anyone pasting an ID.
//
// The sweep is driven from HERE, one batch at a time, rather than being a single
// server call: the lookups are serial and rate-paced, so a whole org easily
// outlives a serverless request. Batching also means the progress this draws is
// real — every step is a request that actually finished.
import { useRef, useState } from "react";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";

// What one POST /api/slack/sync hands back (lib/slack.ts SlackSyncBatch).
type Batch = {
  total: number;
  processed: number;
  matched: number;
  synced: number;
  // Lookups that got no answer at all. Non-zero means the sweep is broken, not
  // that nobody matched — see the check in run().
  failed: number;
  done: boolean;
};

type Phase = "confirm" | "running" | "done" | "error";

export default function SlackSyncModal({
  open,
  orgId,
  workspaceName,
  onClose,
}: {
  open: boolean;
  orgId: string;
  // The Slack workspace this org is connected to, when we know its name — it's
  // worth naming, since the whole point of a re-sync is often that it changed.
  workspaceName?: string | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  // Matched across the WHOLE run — each batch reports only its own.
  const [matched, setMatched] = useState(0);
  const [synced, setSynced] = useState(0);
  const [error, setError] = useState("");
  // Set when the dialog closes mid-run so the loop stops instead of writing
  // progress into a dialog nobody is looking at.
  const cancelled = useRef(false);

  function close() {
    cancelled.current = true;
    onClose();
    // Next open starts at the confirmation again, not on a stale result.
    setPhase("confirm");
    setProcessed(0);
    setTotal(0);
    setMatched(0);
    setSynced(0);
    setError("");
  }

  // `startAt` lets "Try again" resume from the person the failed run stopped at
  // rather than re-walking the org — the window that failed is retried first.
  async function run(startAt = 0) {
    cancelled.current = false;
    setPhase("running");
    setProcessed(startAt);
    setError("");

    let offset = startAt;
    // A resume keeps the count from the part that already succeeded.
    let found = startAt > 0 ? matched : 0;
    setMatched(found);
    // Each pass asks for the next window and feeds its `processed` back as the
    // next offset, so the windows tile the org exactly once.
    for (;;) {
      let batch: Batch;
      try {
        const res = await fetch(`/api/slack/sync?orgId=${orgId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (cancelled.current) return;
          setError(data.error ?? "Slack couldn't be reached. Nothing was changed.");
          setPhase("error");
          return;
        }
        batch = data as Batch;
      } catch {
        if (cancelled.current) return;
        setError("The connection dropped partway through. You can run this again.");
        setPhase("error");
        return;
      }

      if (cancelled.current) return;

      // A 200 is not the same as a working sync. The lookups happen one per
      // person INSIDE the request, and each can be rejected on its own — so a
      // batch can come back perfectly well-formed having achieved nothing. The
      // server counts those and stops at the first; reporting them as a clean
      // run is how a wholly broken sweep used to look like a successful one
      // where nobody happened to match.
      if (batch.failed > 0) {
        setError(
          "Error trying to sync contacts — Slack rejected the lookups. " +
            "Nobody was changed past this point. Check the workspace is still " +
            "connected, then try again."
        );
        setPhase("error");
        return;
      }

      found += batch.matched;
      offset = batch.processed;
      setProcessed(batch.processed);
      setTotal(batch.total);
      setMatched(found);
      setSynced(batch.synced);
      if (batch.done) {
        setPhase("done");
        return;
      }
    }
  }

  // Nothing to divide by before the first batch reports the org's size.
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Sync team members with Slack"
      subtitle={workspaceName ?? undefined}
      footer={
        phase === "running" ? (
          // Stops the sweep at the end of the batch in flight and dismisses the
          // dialog. It cancels the REST of the run, not what it already did —
          // everyone matched up to this point stays matched.
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        ) : phase === "confirm" ? (
          // Modal's footer is already a right-aligned row, so these are bare.
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => run()}>Sync now</Button>
          </>
        ) : (
          <>
            {phase === "error" && (
              <Button variant="secondary" onClick={() => run(processed)}>
                Try again
              </Button>
            )}
            <Button onClick={close}>Done</Button>
          </>
        )
      }
    >
      {phase === "confirm" && (
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
          <p>
            This goes through <span className="font-medium">everyone in this org</span>{" "}
            and looks them up in Slack by the email address on their account. When
            Slack has a match, their Slack ID is saved so the bot can DM them.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              People who are <span className="font-medium">already linked</span> are
              checked again too — run this after connecting a different workspace to
              replace the IDs from the old one.
            </li>
            <li>
              Anyone with no email on their account, or whose email isn&apos;t in the
              workspace, is skipped and left as they are. You can set their ID by
              hand on the Team page.
            </li>
            <li>
              Nobody is messaged and nothing is posted — this only reads Slack&apos;s
              directory.
            </li>
          </ul>
        </div>
      )}

      {(phase === "running" || phase === "done") && (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">
                {phase === "done"
                  ? "Checked everyone in this org."
                  : total > 0
                    ? `Checking ${processed} of ${total} people…`
                    : "Starting…"}
              </span>
              <span className="tabular-nums text-xs text-gray-500">{percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total || 100}
              aria-valuenow={processed}
              className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            >
              <div
                className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {phase === "done" && (
            <div className="space-y-1 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/40">
              <p className="text-sm font-medium">
                Matched {matched} {matched === 1 ? "person" : "people"}.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Now{" "}
                <span className="font-medium tabular-nums">
                  {synced}/{total}
                </span>{" "}
                synced.
              </p>
              {synced < total && (
                <p className="pt-1 text-xs text-gray-500">
                  The rest have no email on file, or an email Slack doesn&apos;t
                  recognise. Their Slack ID can be set by hand on the Team page.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2 text-sm">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <p className="text-gray-600 dark:text-gray-300">
            {processed > 0
              ? `${processed} of ${total} people were checked before it stopped — everyone matched so far is saved, and running it again picks the rest up.`
              : "Nothing was changed."}
          </p>
        </div>
      )}
    </Modal>
  );
}
