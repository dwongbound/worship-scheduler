"use client";
// Full-page org settings. A left rail lists every org I belong to (the current
// one selected); the right pane holds that org's settings — right now just the
// per-org Slack workspace connection, which only an org admin can change.
// Reached from the navbar org switcher's "Org settings" item. This replaces the
// old cramped per-org settings modal that used to live in OrgSwitcher.
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Banner from "@/components/common/Banner";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import InfoTooltip from "@/components/common/InfoTooltip";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import { useMe } from "@/components/MeProvider";
import OrgTeamsManager from "@/components/OrgTeamsManager";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
import type { ApiMeMembership } from "@/lib/types";

// The "Spotify account" line once an org is connected. Prefers the account's
// display name, falls back to its Spotify user id, and if we have neither just
// says it's connected — better than naming an account we can't actually name.
function spotifyAccountLabel(m: ApiMeMembership): string {
  const name = m.spotifyDisplayName ?? m.spotifyUserId;
  return name ? `Connected as ${name} ✓` : "Connected ✓";
}

// What /api/spotify/callback's ?spotify=<status> means to a human. The route
// logs the real detail server-side; these are the only words the admin sees.
const SPOTIFY_NOTICES: Record<string, { tone: "indigo" | "amber"; text: string }> = {
  connected: { tone: "indigo", text: "Spotify connected — set playlists can now be created." },
  denied: { tone: "amber", text: "Spotify authorization was cancelled, so nothing changed." },
  expired: {
    tone: "amber",
    text: "That Spotify link had already been used or expired. Click Connect to Spotify to start again.",
  },
  forbidden: { tone: "amber", text: "Only an admin of that org can connect its Spotify account." },
  error: {
    tone: "amber",
    text: "Spotify refused the connection — this is a problem with the Spotify app itself, not your account. The server log has Spotify's reason.",
  },
};

export default function OrgSettingsPage() {
  const { orgs, viewOrgId, adminOrgId } = useOrgs();
  const { update } = useSession();
  // Per-org Slack status lives on /api/me's memberships (fetched once by
  // AuthGate and shared via MeProvider), not /api/orgs. refreshMe() re-pulls it
  // after a connect so this page's status updates without its own /api/me.
  const { me, refreshMe } = useMe();
  const memberships = me?.memberships ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Add-an-org modal (same join-by-key flow as the navbar switcher).
  // Outcome of a Spotify connect round-trip, read once from ?spotify= on mount.
  const [spotifyNotice, setSpotifyNotice] =
    useState<{ tone: "indigo" | "amber"; text: string } | null>(null);
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

  // /api/spotify/callback sends the admin back here with ?spotify=<status>.
  // Show what happened, then strip the param so a reload doesn't re-announce it.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("spotify");
    if (!status) return;
    setSpotifyNotice(SPOTIFY_NOTICES[status] ?? SPOTIFY_NOTICES.error);
    window.history.replaceState(null, "", window.location.pathname);
    if (status === "connected") refreshMe();
  }, [refreshMe]);

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
      await refreshMe();
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

      {spotifyNotice && (
        <Banner tone={spotifyNotice.tone} onDismiss={() => setSpotifyNotice(null)}>
          {spotifyNotice.text}
        </Banner>
      )}

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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Slack workspace</p>
                    <InfoTooltip text="Connects this org to your church's Slack. The bot DMs people about swap requests and availability requests, sends each team its weekly set summary, and spins up a group chat for a set from its detail modal. Everything Slack-related is off until an admin connects it here." />
                  </div>
                  {/* The connection flags ride along on /api/me, which AuthGate
                      resolves before this page renders — so anything that isn't
                      a live connection is genuinely "not connected", never a
                      pending check. */}
                  <p className="text-sm text-gray-500">
                    {slack?.orgSlackConnected
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
                            await refreshMe();
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

                {/* Spotify — the shared church account this org's set playlists
                    are created under. Same connect/disconnect shape as Slack. */}
                <div className="mt-6 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Spotify account</p>
                    <InfoTooltip text="One shared church account that owns this org's set playlists. Once connected, a set's songs become a collaborative Spotify playlist when its Slack group chat is created — anyone with the link can add or fix songs. Connect the account the whole team should share, not your personal one." />
                  </div>
                  <p className="text-sm text-gray-500">
                    {/* Name the account when we know it. The old fallback
                        said "Connected as Spotify", which reads like the
                        account is *named* Spotify — say nothing rather than
                        something wrong. A blank name means the connect-time
                        /me lookup came back empty; reconnecting refills it. */}
                    {slack?.orgSpotifyConnected
                      ? spotifyAccountLabel(slack)
                      : "Not connected — set playlists can't be created yet."}
                  </p>

                  {selected.isAdmin ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        onClick={() => {
                          window.location.href = `/api/spotify/connect?orgId=${selected.id}`;
                        }}
                      >
                        {slack?.orgSpotifyConnected
                          ? "Reconnect Spotify"
                          : "Connect to Spotify"}
                      </Button>
                      {slack?.orgSpotifyConnected && (
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            await fetch(
                              `/api/spotify/connect?orgId=${selected.id}`,
                              { method: "DELETE" }
                            );
                            await refreshMe();
                          }}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="pt-1 text-xs text-gray-400">
                      Only an admin of this org can change its Spotify connection.
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

                {/* Teams + scheduled weekly Slack reminders (admins only). */}
                {selected.isAdmin && <OrgTeamsManager orgId={selected.id} />}
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
