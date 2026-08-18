"use client";
// Admin-only "Approvals" tab: cover-takes and targeted swaps that have been
// taken/accepted and now need an admin's sign-off. Approve finalizes the
// handoff; reject undoes it (a swap snaps back to the original owners, a cover
// re-opens for someone else to take). Scoped to the admin org in the switcher.
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import type { ApiApproval, SwapSetRef } from "@/lib/types";

export default function ApprovalsPage() {
  const { data: session, status } = useSession();
  const { adminOrgId, isAdminAny } = useOrgs();
  const [items, setItems] = useState<ApiApproval[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!adminOrgId) return;
    const data = await fetchJsonArray<ApiApproval>("/api/admin/approvals", {
      headers: orgHeaders(adminOrgId),
    });
    setItems(data);
  }, [adminOrgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(
    item: ApiApproval,
    action: "approve" | "reject"
  ) {
    if (!adminOrgId) return;
    setBusyId(item.id);
    try {
      await fetch("/api/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({ kind: item.kind, id: item.id, action }),
      });
      await load();
      // Refresh the navbar's Approvals dot (and swap dot) right away.
      window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
    } finally {
      setBusyId(null);
    }
  }

  usePageLoading(!items && isAdminAny);

  if (status === "loading") return null;
  if (!isAdminAny) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }
  if (!items) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Cover-takes and swaps waiting on your sign-off. Approve to finalize, or
          reject to undo (a swap goes back to the original people; a cover
          re-opens for someone else).
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-gray-500">Nothing waiting for approval.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <Card className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {item.kind === "cover" ? (
                    <>
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        <Badge tone="indigo">Cover</Badge>
                        {item.set.label ?? "Worship Set"} —{" "}
                        {INSTRUMENT_LABELS[item.role]}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {when(item.set)} · <strong>{item.taker.name}</strong>{" "}
                        wants to cover{" "}
                        {item.originalOwner?.name ?? "someone"}’s slot
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        <Badge tone="blue">Swap</Badge>
                        {INSTRUMENT_LABELS[item.role]}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong>{item.recipient.name}</strong> takes{" "}
                        {item.receive.label ?? "Worship Set"} ({when(item.receive)});{" "}
                        <strong>{item.requester.name}</strong> takes{" "}
                        {item.giveUp.label ?? "Worship Set"} ({when(item.giveUp)})
                      </p>
                    </>
                  )}
                  {item.reason && (
                    <p className="mt-1 text-sm italic text-gray-500 dark:text-gray-400">
                      “{item.reason}”
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {busyId === item.id ? (
                    <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <>
                      <Button size="sm" onClick={() => decide(item, "approve")}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => decide(item, "reject")}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "Sun, Aug 3 · 7:00 PM" for a set reference.
function when(set: SwapSetRef): string {
  return `${formatDay(set.startsAt)} · ${formatTime(set.startsAt)}`;
}
