"use client";
// Full-page org settings. A left rail lists every org I belong to (the current
// one selected); the right pane holds that org's settings — right now just the
// per-org Slack workspace connection, which only an org admin can change.
// Reached from the navbar org switcher's "Org settings" item. This replaces the
// old cramped per-org settings modal that used to live in OrgSwitcher.
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";

// Just the per-org fields /api/me exposes that this page cares about.
type MeMembership = {
  orgId: string;
  isAdmin: boolean;
  orgSlackConnected: boolean;
  slackTeamName: string | null;
};

export default function OrgSettingsPage() {
  const { orgs, viewOrgId, adminOrgId } = useOrgs();
  const { update } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MeMembership[] | null>(null);
  // Add-an-org modal (same join-by-key flow as the navbar switcher).
  const [addOpen, setAddOpen] = useState(false);
  const [orgKey, setOrgKey] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  // Join key for the selected org (admins only). `null` = not loaded yet.
  const [joinKey, setJoinKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);

  // Per-org Slack status lives on /api/me's memberships, not /api/orgs.
  const loadMe = useCallback(async () => {
    const me = await fetch("/api/me")
      .then((r) => r.json())
      .catch(() => null);
    setMemberships(me?.memberships ?? []);
  }, []);
  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Default the selection to the "current" org — whatever the switcher points
  // at — falling back to the first org. Only runs until a valid pick is set so
  // it never fights the user's clicks.
  useEffect(() => {
    if (!orgs || orgs.length === 0) return;
    setSelectedId((cur) => {
      if (cur && orgs.some((o) => o.id === cur)) return cur;
      if (viewOrgId !== "all" && orgs.some((o) => o.id === viewOrgId)) {
        return viewOrgId;
      }
      if (adminOrgId && orgs.some((o) => o.id === adminOrgId)) return adminOrgId;
      return orgs[0].id;
    });
  }, [orgs, viewOrgId, adminOrgId]);

  // Load the selected org's join key whenever the selection changes — but only
  // for orgs I administer (the endpoint 403s otherwise).
  useEffect(() => {
    setJoinKey(null);
    setKeyDraft("");
    setKeyError("");
    setKeyCopied(false);
    if (!selectedId) return;
    const org = orgs?.find((o) => o.id === selectedId);
    if (!org?.isAdmin) return;
    let cancelled = false;
    fetch(`/api/orgs/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setJoinKey(data.joinKey ?? "");
        setKeyDraft(data.joinKey ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, orgs]);

  // Save a new key: rotate a random one, or set the typed value.
  async function saveKey(rotate: boolean) {
    if (!selectedId) return;
    setKeyBusy(true);
    setKeyError("");
    try {
      const res = await fetch(`/api/orgs/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rotate ? { rotateKey: true } : { joinKey: keyDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKeyError(data.error ?? "Could not update the key.");
        return;
      }
      setJoinKey(data.joinKey ?? "");
      setKeyDraft(data.joinKey ?? "");
      setKeyCopied(false);
    } finally {
      setKeyBusy(false);
    }
  }

  async function addOrg() {
    setAddBusy(true);
    setAddError("");
    try {
      const res = await fetch("/api/orgs/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: orgKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(data.error ?? "Could not join the organization.");
        return;
      }
      setAddOpen(false);
      setOrgKey("");
      await update(); // refresh membership hints in the JWT
      window.dispatchEvent(new Event(ORGS_CHANGED_EVENT));
      await loadMe();
    } finally {
      setAddBusy(false);
    }
  }

  usePageLoading(orgs === null);
  if (!orgs) return null;

  const selected = orgs.find((o) => o.id === selectedId) ?? null;
  const slack = memberships?.find((m) => m.orgId === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Org settings</h1>

      {orgs.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">
            You&apos;re not in any organizations yet.
          </p>
          <Button className="mt-3" onClick={() => setAddOpen(true)}>
            + Add an org…
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row">
          {/* Left rail: my orgs, current one highlighted. */}
          <aside className="shrink-0 space-y-1 sm:w-56">
            {orgs.map((o) => {
              const active = o.id === selectedId;
              return (
                <button
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  {o.isAdmin && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Admin
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => {
                setAddError("");
                setOrgKey("");
                setAddOpen(true);
              }}
              className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              + Add an org…
            </button>
          </aside>

          {/* Right pane: the selected org's settings. */}
          <section className="min-w-0 flex-1">
            {selected && (
              <Card>
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {selected.isAdmin ? "Admin" : "Member"}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Slack workspace</p>
                  <p className="text-sm text-gray-500">
                    {slack === null
                      ? "Checking…"
                      : slack.orgSlackConnected
                        ? `Connected to ${slack.slackTeamName ?? "Slack"} ✓`
                        : "Not connected — the bot can't message this org yet."}
                  </p>

                  {selected.isAdmin ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        onClick={() => {
                          window.location.href = `/api/slack/install?orgId=${selected.id}`;
                        }}
                      >
                        {slack?.orgSlackConnected
                          ? "Reconnect Slack"
                          : "Connect to Slack"}
                      </Button>
                      {slack?.orgSlackConnected && (
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            await fetch(
                              `/api/slack/install?orgId=${selected.id}`,
                              { method: "DELETE" }
                            );
                            await loadMe();
                          }}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="pt-1 text-xs text-gray-400">
                      Only an admin of this org can change its Slack connection.
                    </p>
                  )}
                </div>

                {/* Join key — admins can copy it, set a custom one, or rotate
                    to a fresh random key (invalidating the old one). */}
                {selected.isAdmin && (
                  <div className="mt-6 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
                    <p className="text-sm font-medium">Join key</p>
                    <p className="text-sm text-gray-500">
                      People join this org by entering this key. Rotating it
                      stops the old key from working.
                    </p>
                    {joinKey === null ? (
                      <p className="text-sm text-gray-400">Loading…</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <input
                            value={keyDraft}
                            onChange={(e) => {
                              setKeyDraft(e.target.value);
                              setKeyCopied(false);
                            }}
                            aria-label="Join key"
                            className="w-56 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5
                              font-mono text-sm dark:border-gray-600 dark:bg-gray-900"
                          />
                          <Button
                            variant="secondary"
                            onClick={() => {
                              if (joinKey) {
                                navigator.clipboard.writeText(joinKey);
                                setKeyCopied(true);
                              }
                            }}
                            disabled={!joinKey}
                          >
                            {keyCopied ? "Copied ✓" : "Copy"}
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            onClick={() => saveKey(false)}
                            disabled={
                              keyBusy || !keyDraft.trim() || keyDraft === joinKey
                            }
                          >
                            {keyBusy ? "Saving…" : "Save key"}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => saveKey(true)}
                            disabled={keyBusy}
                          >
                            Rotate
                          </Button>
                        </div>
                        {keyError && (
                          <p className="text-sm text-red-600">{keyError}</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </Card>
            )}
          </section>
        </div>
      )}

      {addOpen && (
        <Modal open onClose={() => setAddOpen(false)} title="Add an organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addOrg();
            }}
            className="space-y-4"
          >
            <Input
              label="Organization key"
              value={orgKey}
              onChange={(e) => setOrgKey(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addBusy || !orgKey.trim()}>
                {addBusy ? "Joining…" : "Join"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
