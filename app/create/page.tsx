"use client";
// Create tab (admins only): define weekly set templates, run the
// auto-scheduler, and see who has finished entering availability.
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Input from "@/components/common/Input";
import Select from "@/components/common/Select";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import TemplateModal from "@/components/TemplateModal";
import StagedScheduleModal from "@/components/StagedScheduleModal";
import {
  DAY_LABELS,
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  resolveCapacities,
} from "@/lib/constants";
import { minutesToTimeLabel, shortRangeLabel } from "@/lib/dates";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { useOrgs } from "@/components/OrgProvider";
import type {
  ApiAdminUser,
  ApiAvailabilityRequest,
  ApiSetTemplate,
  ApiUnavailability,
  StagedPlan,
  StagedSet,
} from "@/lib/types";

// Max rows the Weekly Recurring Sets table shows per page.
const TEMPLATES_PER_PAGE = 4;

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

type AdminUnavailabilityEntry = ApiAdminUser["unavailability"][number];

export default function CreatePage() {
  const { status } = useSession();
  const [templates, setTemplates] = useState<ApiSetTemplate[] | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  // All availability requests + which one the status panel is filtered to.
  const [requests, setRequests] = useState<ApiAvailabilityRequest[] | null>(
    null
  );
  const [statusRequestId, setStatusRequestId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // Slack "remind everyone to fill in availability" confirm flow.
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindResult, setRemindResult] = useState("");
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "generate" | "apply" | "request" | null
  >(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState("");
  // The proposed schedule awaiting the admin's review (null = not staging).
  const [stagedPlan, setStagedPlan] = useState<StagedPlan | null>(null);
  // The "add weekly set time" popup (opened by "Add" on the templates card).
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // Which page of the Weekly Recurring Sets table is shown (4 rows per page).
  const [templatePage, setTemplatePage] = useState(0);
  const [weeks, setWeeks] = useState(12); // ~3 months
  // Generate scope: "weeks" ahead from now, an explicit date range, or the span
  // of a named availability request ("request" + genRequestId).
  const [genMode, setGenMode] = useState<"weeks" | "range" | "request">(
    "weeks"
  );
  const [genRequestId, setGenRequestId] = useState("");
  const [genStart, setGenStart] = useState("");
  const [genEnd, setGenEnd] = useState("");

  // "Request availabilities" form state.
  const [reqName, setReqName] = useState("");
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqResult, setReqResult] = useState("");

  // Everything on this page operates on ONE org: the navbar switcher's admin
  // selection. Every admin API call names it via the x-org-id header.
  const { adminOrgId, isAdminAny } = useOrgs();

  const reload = useCallback(async () => {
    if (!adminOrgId) return;
    const init = { headers: orgHeaders(adminOrgId) };
    // Resolve to [] on any error so the page always renders instead of
    // hanging on the loading screen forever when an endpoint fails.
    const [tpl, us, reqs] = await Promise.all([
      fetchJsonArray<ApiSetTemplate>("/api/admin/templates", init),
      fetchJsonArray<ApiAdminUser>("/api/admin/users", init),
      fetchJsonArray<ApiAvailabilityRequest>(
        "/api/admin/availability-request",
        init
      ),
    ]);
    setTemplates(tpl);
    setUsers(us);
    setRequests(reqs);
    // Default the status filter to the newest request (list is newest-first).
    // Reset on an org switch — the previous org's request id means nothing here.
    setStatusRequestId(reqs[0]?.id || "");
  }, [adminOrgId]);

  // `reload`'s identity only changes when adminOrgId does, so this fires on an
  // org switch (not the in-place reloads mutations trigger). Blank the page
  // first so the full-page loader covers the swap and the previous org's data
  // never lingers on screen; reload() then refills everything as one unit.
  useEffect(() => {
    setTemplates(null);
    setUsers(null);
    setRequests(null);
    reload();
  }, [reload]);

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(
    status === "loading" ||
      (isAdminAny && !!adminOrgId && (!templates || !users || !requests))
  );

  if (status === "loading") return null;
  // Non-admins never see the tab in the navbar, but guard direct visits too.
  if (!isAdminAny) {
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

  // Re-send the Slack DM asking everyone (with Slack linked) to fill in the
  // selected request. Fired from the confirm modal on the status card.
  async function sendReminder() {
    if (!selectedRequestId) return;
    setRemindBusy(true);
    setRemindResult("");
    try {
      const res = await fetch(
        `/api/admin/availability-request/${selectedRequestId}/remind`,
        { method: "POST", headers: orgHeaders(adminOrgId) }
      );
      setRemindResult(
        res.ok ? "Reminder sent on Slack." : "Could not send the reminder."
      );
    } catch {
      setRemindResult("Could not send the reminder.");
    } finally {
      setRemindBusy(false);
      setRemindOpen(false);
    }
  }

  // Ask the whole team to submit availability over a date range. Everyone who
  // hasn't responded sees a reminder dot + banner until they do.
  async function requestAvailability() {
    if (!reqStart) return;
    setBusyAction("request");
    setReqResult("");
    try {
      const res = await fetch("/api/admin/availability-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({
          name: reqName,
          startDate: reqStart,
          // No end date → a single-day request (defaults to the start date).
          endDate: reqEnd || reqStart,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setReqName("");
        // Refresh so the status card's Request dropdown picks up (and selects)
        // the just-created request without a page reload.
        await reload();
      }
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
    // In range mode, both endpoints are required.
    if (genMode === "range" && (!genStart || !genEnd)) {
      setGenerateResult("Error: pick both a start and end date.");
      return;
    }
    if (genMode === "request" && !genRequestId) {
      setGenerateResult("Error: pick an availability request.");
      return;
    }
    setBusyAction("generate");
    setGenerateResult("");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify(
          genMode === "range"
            ? { startDate: genStart, endDate: genEnd }
            : genMode === "request"
              ? { requestId: genRequestId }
              : { weeks }
        ),
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
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
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

  if (!templates || !users || !requests) return null;

  // Human label for a request in the TimeRange dropdown.
  function requestLabel(r: ApiAvailabilityRequest): string {
    const range = shortRangeLabel(r.startDate, r.endDate);
    return r.name ? `${r.name} — ${range}` : range;
  }

  function formatUnavailability(entry: AdminUnavailabilityEntry): string {
    if (entry.type === "RECURRING") {
      return `Every ${DAY_LABELS[entry.dayOfWeek!]} from ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
    }
    if (entry.type === "SPECIFIC") {
      return `${new Date(entry.startDate!).toLocaleDateString()} ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
    }
    return `${new Date(entry.startDate!).toLocaleDateString()} to ${new Date(entry.endDate!).toLocaleDateString()} ${minutesToTimeLabel(entry.startMinute!)} to ${minutesToTimeLabel(entry.endMinute!)}`;
  }

  const selectedRequestId = statusRequestId || requests[0]?.id || "";
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null;
  const sortedUsers = [...users].sort((a, b) => {
    const aDone = Boolean(
      a.availabilityResponses.find(
        (r) => r.requestId === selectedRequestId && r.completedAt
      )
    );
    const bDone = Boolean(
      b.availabilityResponses.find(
        (r) => r.requestId === selectedRequestId && r.completedAt
      )
    );
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const selectedUser = sortedUsers.find((u) => u.id === selectedUserId) ?? null;
  const visibleUnavailability: AdminUnavailabilityEntry[] = selectedUser && selectedRequest
    ? selectedUser.unavailability.filter((entry) => {
        if (entry.type === "SPECIFIC") {
          return entry.requestId === selectedRequestId;
        }
        if (entry.type === "DATE_RANGE") {
          const entryStart = entry.startDate ? new Date(entry.startDate) : null;
          const entryEnd = entry.endDate ? new Date(entry.endDate) : null;
          const reqStart = new Date(selectedRequest.startDate);
          const reqEnd = new Date(selectedRequest.endDate);
          return entryStart && entryEnd && entryStart <= reqEnd && entryEnd >= reqStart;
        }
        return true;
      })
    : [];

  // The availability request chosen as the "Generate" scope (null unless the
  // admin picked one) — used for the range summary under the picker.
  const genRequest = requests.find((r) => r.id === genRequestId) ?? null;

  // Paginate the templates table. Clamp the page here (instead of storing the
  // clamped value) so deleting the last row of the final page can't strand the
  // view on an empty page.
  const templatePageCount = Math.max(
    1,
    Math.ceil(templates.length / TEMPLATES_PER_PAGE)
  );
  const currentTemplatePage = Math.min(templatePage, templatePageCount - 1);
  // Ordered Monday→Sunday (day 0=Sun, so shift to a Mon-first index), then by
  // start time within a day, so the list stays in weekly order as rows are added.
  const orderedTemplates = [...templates].sort((a, b) => {
    const dayA = (a.dayOfWeek + 6) % 7;
    const dayB = (b.dayOfWeek + 6) % 7;
    return dayA - dayB || a.startMinute - b.startMinute;
  });
  const visibleTemplates = orderedTemplates.slice(
    currentTemplatePage * TEMPLATES_PER_PAGE,
    (currentTemplatePage + 1) * TEMPLATES_PER_PAGE
  );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Create Sets</h1>

      {/* ── Weekly templates ────────────────────────────────────────── */}
      <section>
        <Card>
          <div className="mb-3">
            <h2 className="font-semibold">Weekly Recurring Sets</h2>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">No templates yet.</p>
          ) : (
            // Same table styling as the "Availability status" card below.
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTemplates.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                  >
                    <td className="py-2 pr-4 font-medium">
                      {t.label}
                      {t.team && (
                        <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                          {t.team.name}
                        </span>
                      )}
                      {capacitiesSummary(t.slotCapacities) && (
                        // Non-default team shape, e.g. "3× Electric Guitar".
                        <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                          {capacitiesSummary(t.slotCapacities)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {DAY_LABELS[t.dayOfWeek]} · {minutesToTimeLabel(t.startMinute)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        onClick={() => removeTemplate(t.id)}
                        disabled={busyTemplateId === t.id}
                      >
                        {busyTemplateId === t.id ? <LoadingDots size="sm" /> : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Transparent full-width add row beneath the list. Keeps the
              accessible name the e2e specs click on. */}
          <button
            type="button"
            onClick={() => setTemplateModalOpen(true)}
            aria-label="Add weekly set time"
            className="mt-2 w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
          >
            + Add
          </button>
          {/* Pager — only when there's more than one page of templates. */}
          {templatePageCount > 1 && (
            <div className="mt-3 flex items-center justify-end gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Page {currentTemplatePage + 1} of {templatePageCount}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTemplatePage(currentTemplatePage - 1)}
                disabled={currentTemplatePage === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTemplatePage(currentTemplatePage + 1)}
                disabled={currentTemplatePage >= templatePageCount - 1}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* ── Request availabilities  +  Availability status (50/50) ──── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: request the team to enter their availability */}
        <Card>
          <h2 className="mb-3 font-semibold">Request availabilities</h2>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Ask the team to enter when they&rsquo;re unavailable over a date
            range. Everyone who hasn&rsquo;t responded sees a reminder until
            they do.
          </p>
          <div className="space-y-3">
            <Input
              label="Name (optional)"
              value={reqName}
              onChange={(e) => setReqName(e.target.value)}
              placeholder="e.g. Passion Week 2026"
            />
            <div className="grid grid-cols-2 gap-3">
              <DateSelect
                label="From"
                value={reqStart}
                min={toYmd(new Date())}
                max={reqEnd || undefined}
                onChange={setReqStart}
              />
              <DateSelect
                label="To (optional)"
                value={reqEnd}
                min={reqStart || toYmd(new Date())}
                onChange={setReqEnd}
              />
            </div>
            <Button
              onClick={requestAvailability}
              disabled={!reqStart || busyAction === "request"}
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

        {/* Right: who has responded, filtered by TimeRange */}
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Availability status</h2>
            {selectedRequest && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRemindResult("");
                  setRemindOpen(true);
                }}
              >
                Remind on Slack
              </Button>
            )}
          </div>
          {remindResult && (
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              {remindResult}
            </p>
          )}
          {requests.length > 0 && (
            <div className="mb-3">
              <Select
                label="Request Name"
                value={statusRequestId}
                onChange={(e) => setStatusRequestId(e.target.value)}
              >
                {requests.map((r) => (
                  // <option> can't contain markup (React hydration error), so
                  // plain text only — no <strong> here.
                  <option key={r.id} value={r.id}>
                    {r.name || "Availability"} (
                    {shortRangeLabel(r.startDate, r.endDate)})
                  </option>
                ))}
              </Select>
            </div>
          )}
          {requests.length === 0 ? (
            <p className="text-sm text-gray-500">
              No availability requests yet.
            </p>
          ) : (
            <div className="max-h-[16rem] overflow-y-scroll rounded-md">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((u) => {
                    const done = u.availabilityResponses.find(
                      (r) => r.requestId === selectedRequestId && r.completedAt
                    );
                    return (
                      <tr
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedUserId(u.id);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        className={`cursor-pointer border-b border-gray-100 last:border-0 transition-colors hover:bg-indigo-50 dark:border-gray-700/50 dark:hover:bg-indigo-900/20 ${selectedUserId === u.id ? "bg-indigo-50 dark:bg-indigo-900/20" : ""}`}
                      >
                        <td className="py-2 pr-4 font-medium">{u.name}</td>
                        <td className="py-2">
                          {done ? (
                            <Badge tone="green">
                              {done.edited ? "Edited " : "Done "}
                              {new Date(done.completedAt!).toLocaleDateString()}
                            </Badge>
                          ) : (
                            <Badge tone="amber">Not yet</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

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
        {/* Scope: N weeks ahead, an explicit date range, or the span of a
            named availability request (so you schedule exactly what you asked
            the team about). Request options carry a "req:" value prefix. */}
        <div className="mb-3 w-64">
          <Select
            label="Schedule for"
            value={genMode === "request" ? `req:${genRequestId}` : genMode}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("req:")) {
                setGenMode("request");
                setGenRequestId(v.slice(4));
              } else {
                setGenMode(v as "weeks" | "range");
              }
            }}
          >
            <option value="weeks">Weeks ahead</option>
            <option value="range">Date range</option>
            {requests.length > 0 && (
              <optgroup label="Availability request">
                {requests.map((r) => (
                  <option key={r.id} value={`req:${r.id}`}>
                    {requestLabel(r)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {genMode === "request" ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {genRequest
                ? `Scheduling ${shortRangeLabel(genRequest.startDate, genRequest.endDate)}.`
                : "Pick an availability request above."}
            </p>
          ) : genMode === "weeks" ? (
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
          ) : (
            <>
              <div className="w-40">
                <DateSelect
                  label="Start date"
                  value={genStart}
                  max={genEnd || undefined}
                  onChange={(v) => {
                    setGenStart(v);
                    if (genEnd && genEnd < v) setGenEnd("");
                  }}
                  required
                />
              </div>
              <div className="w-40">
                <DateSelect
                  label="End date"
                  value={genEnd}
                  min={genStart || undefined}
                  onChange={setGenEnd}
                  required
                />
              </div>
            </>
          )}
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

      <Modal
        open={Boolean(selectedUser && selectedRequest)}
        onClose={() => setSelectedUserId(null)}
        title={`${selectedUser?.name ?? "Person"}'s unavailable times`}
      >
        {selectedUser && selectedRequest && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              {requestLabel(selectedRequest)}
            </p>
            {Boolean(
              selectedUser.availabilityResponses.find(
                (r) => r.requestId === selectedRequestId && r.completedAt
              )
            ) ? (
              visibleUnavailability.length === 0 ? (
                <p className="text-sm text-gray-500">
                  They haven&apos;t entered any unavailability blocks for this range.
                </p>
              ) : (
                <ul className="space-y-2">
                  {visibleUnavailability.map((entry) => (
                    <li
                      key={`${entry.type}-${entry.startDate ?? ""}-${entry.startMinute ?? ""}-${entry.endMinute ?? ""}`}
                      className="rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/60"
                    >
                      <div>{formatUnavailability(entry)}</div>
                      {entry.note && (
                        <div className="mt-1 text-xs text-gray-500">
                          {entry.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="text-sm text-gray-500">
                They haven&apos;t submitted availability for this time range yet.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        title="Remind on Slack"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setRemindOpen(false)}
              disabled={remindBusy}
            >
              Cancel
            </Button>
            <Button onClick={sendReminder} disabled={remindBusy}>
              {remindBusy ? <LoadingDots size="sm" /> : "Send reminder"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This sends a direct message on Slack to everyone with Slack linked,
          asking them to fill out their availability for{" "}
          <strong>
            {selectedRequest
              ? `${selectedRequest.name || "Availability"} (${shortRangeLabel(
                  selectedRequest.startDate,
                  selectedRequest.endDate
                )})`
              : "this request"}
          </strong>
          .
        </p>
      </Modal>

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
