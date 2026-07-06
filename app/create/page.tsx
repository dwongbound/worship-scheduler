"use client";
// Create tab (admins only): define weekly set templates, run the
// auto-scheduler, and see who has finished entering availability.
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import TemplateModal from "@/components/TemplateModal";
import StagedScheduleModal from "@/components/StagedScheduleModal";
import {
  DAY_LABELS,
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  resolveCapacities,
} from "@/lib/constants";
import { minutesToTimeLabel } from "@/lib/dates";
import { fetchJsonArray } from "@/lib/api";
import type {
  ApiAdminUser,
  ApiSetTemplate,
  StagedPlan,
  StagedSet,
} from "@/lib/types";

function durationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "Hr" : "Hrs"}`;
}

// One-line "team shape" summary for the templates list, e.g.
// "2× Electric Guitar, no Acoustic Guitar". Only lists roles that differ from
// the default so common templates stay uncluttered; "" when all-default.
function capacitiesSummary(caps: ApiSetTemplate["slotCapacities"]): string {
  if (!caps) return "";
  const defaults = resolveCapacities(null);
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const n = caps[role];
    if (n === undefined || n === defaults[role]) continue;
    parts.push(n === 0 ? `no ${INSTRUMENT_LABELS[role]}` : `${n}× ${INSTRUMENT_LABELS[role]}`);
  }
  return parts.join(", ");
}

export default function CreatePage() {
  const { data: session, status } = useSession();
  const [templates, setTemplates] = useState<ApiSetTemplate[] | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "generate" | "apply" | "request" | null
  >(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState("");
  // The proposed schedule awaiting the admin's review (null = not staging).
  const [stagedPlan, setStagedPlan] = useState<StagedPlan | null>(null);
  // The "add weekly set time" popup (opened by the "+" in the list card).
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [weeks, setWeeks] = useState(12); // ~3 months

  // "Request availabilities" form state.
  const [reqName, setReqName] = useState("");
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqResult, setReqResult] = useState("");

  const reload = useCallback(async () => {
    // Resolve to [] on any error so the page always renders instead of
    // hanging on the loading screen forever when an endpoint fails.
    const [tpl, us] = await Promise.all([
      fetchJsonArray<ApiSetTemplate>("/api/admin/templates"),
      fetchJsonArray<ApiAdminUser>("/api/admin/users"),
    ]);
    setTemplates(tpl);
    setUsers(us);
  }, []);

  useEffect(() => {
    if (session?.user?.isAdmin) reload();
  }, [session, reload]);

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(
    status === "loading" ||
      (!!session?.user?.isAdmin && (!templates || !users))
  );

  if (status === "loading") return null;
  // Non-admins never see the tab in the navbar, but guard direct visits too.
  if (!session?.user?.isAdmin) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }

  async function removeTemplate(id: string) {
    setBusyTemplateId(id);
    try {
      await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusyTemplateId(null);
    }
  }

  // Ask the whole team to submit availability over a date range. Everyone who
  // hasn't responded sees a reminder dot + banner until they do.
  async function requestAvailability() {
    if (!reqStart || !reqEnd) return;
    setBusyAction("request");
    setReqResult("");
    try {
      const res = await fetch("/api/admin/availability-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: reqName,
          startDate: reqStart,
          endDate: reqEnd,
        }),
      });
      const data = await res.json();
      if (res.ok) setReqName("");
      setReqResult(
        res.ok
          ? "Availability request sent to the team."
          : `Error: ${data.error ?? "unknown"}`
      );
    } finally {
      setBusyAction(null);
    }
  }

  // Step 1 — dry run: expand templates + auto-assign, but persist nothing.
  // The proposal opens in the review modal for the admin to tweak.
  async function generate() {
    setBusyAction("generate");
    setGenerateResult("");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks }),
      });
      const data = await res.json();
      if (res.ok) {
        setStagedPlan(data as StagedPlan);
      } else {
        setGenerateResult(`Error: ${data.error ?? "unknown"}`);
      }
    } finally {
      setBusyAction(null);
    }
  }

  // Step 2 — commit the reviewed plan. This is what actually creates the sets
  // + PENDING assignments (and, later, sends the emails/Slack messages).
  async function applyPlan(sets: StagedSet[]) {
    setBusyAction("apply");
    try {
      const res = await fetch("/api/admin/generate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sets }),
      });
      const data = await res.json();
      setGenerateResult(
        res.ok
          ? `Created ${data.setsCreated} sets and ${data.assignmentsCreated} assignments.`
          : `Error: ${data.error ?? "unknown"}`
      );
      if (res.ok) setStagedPlan(null);
      await reload();
    } finally {
      setBusyAction(null);
    }
  }

  if (!templates || !users) return null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Create Sets</h1>

      {/* ── Weekly templates ────────────────────────────────────────── */}
      <section>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Weekly set times</h2>
            <button
              onClick={() => setTemplateModalOpen(true)}
              aria-label="Add weekly set time"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-lg leading-none text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              +
            </button>
          </div>
          {templates.length === 0 && (
            <p className="text-sm text-gray-500">No templates yet.</p>
          )}
          <ul className="space-y-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  <strong>{t.label}</strong> — every {DAY_LABELS[t.dayOfWeek]}{" "}
                  at {minutesToTimeLabel(t.startMinute)} (
                  {durationLabel(t.durationMinutes)})
                  {capacitiesSummary(t.slotCapacities) && (
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {capacitiesSummary(t.slotCapacities)}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => removeTemplate(t.id)}
                  disabled={busyTemplateId === t.id}
                >
                  {busyTemplateId === t.id ? <LoadingDots size="sm" /> : "Delete"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* ── Request availabilities ──────────────────────────────────── */}
      <Card>
        <h2 className="mb-3 font-semibold">Request availabilities</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Ask the team to enter when they&rsquo;re unavailable over a date
          range. Everyone who hasn&rsquo;t responded sees a reminder until they
          do.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Name (optional)"
            value={reqName}
            onChange={(e) => setReqName(e.target.value)}
            placeholder="e.g. Fall 2026"
          />
          <Input
            label="From"
            type="date"
            value={reqStart}
            onChange={(e) => setReqStart(e.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={reqEnd}
            onChange={(e) => setReqEnd(e.target.value)}
          />
          <Button
            onClick={requestAvailability}
            disabled={!reqStart || !reqEnd || busyAction === "request"}
          >
            {busyAction === "request" ? (
              <LoadingDots size="sm" />
            ) : (
              "Request availabilities"
            )}
          </Button>
        </div>
        {reqResult && (
          <p className="mt-3 text-sm font-medium text-indigo-600 dark:text-indigo-400">
            {reqResult}
          </p>
        )}
      </Card>

      {/* ── Generate ────────────────────────────────────────────────── */}
      <Card>
        <h2 className="mb-3 font-semibold">Generate schedule</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Expands the weekly templates into concrete sets, then auto-assigns
          people based on their instruments and availability (see
          lib/scheduler.ts). You&rsquo;ll get a <strong>preview to review and
          tweak</strong> before anything is saved — nobody is notified until
          you apply.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Input
              label="Weeks ahead"
              type="number"
              min={1}
              max={26}
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            />
          </div>
          <Button
            onClick={generate}
            disabled={busyAction === "generate" || templates.length === 0}
          >
            {busyAction === "generate" ? (
              <LoadingDots size="sm" />
            ) : (
              "Generate preview"
            )}
          </Button>
        </div>
        {generateResult && (
          <p className="mt-3 text-sm font-medium text-indigo-600 dark:text-indigo-400">
            {generateResult}
          </p>
        )}
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Tip: open any set on the{" "}
          <Link href="/calendar" className="font-medium text-indigo-600 underline dark:text-indigo-400">
            Calendar
          </Link>{" "}
          to manually change who&rsquo;s assigned.
        </p>
      </Card>

      {/* ── Who has finished entering availability ──────────────────── */}
      <section>
        <h2 className="mb-3 text-xl font-bold">Availability status</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Instruments</th>
                <th className="px-4 py-3">Scheduling</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                >
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {u.instruments.map((i) => INSTRUMENT_LABELS[i]).join(", ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.scheduleCompletedAt ? (
                      <Badge tone="green">
                        Done{" "}
                        {new Date(u.scheduleCompletedAt).toLocaleDateString()}
                      </Badge>
                    ) : (
                      <Badge tone="amber">Not yet</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <TemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onCreated={reload}
      />

      <StagedScheduleModal
        plan={stagedPlan}
        users={users}
        busy={busyAction === "apply"}
        onApply={applyPlan}
        onClose={() => setStagedPlan(null)}
      />
    </div>
  );
}
