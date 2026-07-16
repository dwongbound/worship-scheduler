"use client";
// Edit personal info: name, email, instruments, and a Slack member ID field
// for the future Slack integration. Password changes happen in a separate
// modal that requires typing the new password twice.
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useRef, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import Modal from "@/components/common/Modal";
import { usePageLoading } from "@/components/LoadingProvider";
import { PROFILE_CHANGED_EVENT } from "@/components/Navbar";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";

type Membership = {
  orgId: string;
  orgName: string;
  slackUserId: string | null;
  orgSlackConnected: boolean;
  slackTeamName: string | null;
};

export default function ProfilePage() {
  const { update } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  // OAuth-only accounts (e.g. Google) have no password to change.
  const [hasPassword, setHasPassword] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Briefly true right after a successful save so the status line can flash a
  // "Saved ✓" confirmation.
  const [saved, setSaved] = useState(false);
  // Snapshot of the last-persisted fields, so an auto-save that would be a
  // no-op (e.g. tabbing out of an unchanged input) is skipped.
  const savedKeyRef = useRef("");

  // Password-change modal state.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((me) => {
        setName(me.name);
        setEmail(me.email ?? "");
        setMemberships(me.memberships ?? []);
        setInstruments(me.instruments);
        setHasPassword(me.hasPassword ?? true);
        savedKeyRef.current = fieldsKey(me.name, me.email ?? "", me.instruments);
        setLoaded(true);
      });
  }, []);

  // Toggling a role saves immediately (no Save button) — pass the next array
  // explicitly since setInstruments is async and state would still be stale.
  function toggleInstrument(inst: Instrument) {
    const next = instruments.includes(inst)
      ? instruments.filter((i) => i !== inst)
      : [...instruments, inst];
    setInstruments(next);
    saveProfile({ instruments: next });
  }

  // The shared PUT body for the profile fields (used by save + password change).
  function profilePayload(extra: Record<string, unknown> = {}) {
    return {
      name,
      email: email || null,
      instruments,
      ...extra,
    };
  }

  // Stable identity for a set of fields, to detect no-op saves.
  function fieldsKey(n: string, e: string, ins: Instrument[]) {
    return JSON.stringify([n.trim(), (e || "").trim(), [...ins].sort()]);
  }

  // Auto-save the profile fields. Fields default to current state; callers pass
  // overrides for values that state hasn't caught up to yet (instrument toggle).
  async function saveProfile(
    overrides: { name?: string; email?: string | null; instruments?: Instrument[] } = {}
  ) {
    const payload = profilePayload(overrides);
    // Name is required — never PUT a blank one (it'd 400 and read as a random
    // error on an unrelated action, e.g. toggling a role).
    if (!payload.name.trim()) {
      setMessage("Error: name is required");
      return;
    }
    const key = fieldsKey(payload.name, payload.email ?? "", payload.instruments);
    if (key === savedKeyRef.current) return; // nothing actually changed

    setMessage("");
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        savedKeyRef.current = key;
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // Refresh the JWT so the navbar shows the new name immediately.
        await update({ name: payload.name });
        // Tell the navbar to re-check the profile so the "finish setup"
        // reminder dot/banner clear the moment a role is saved.
        window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error ?? "could not save"}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function openPasswordModal() {
    setPw1("");
    setPw2("");
    setPwError("");
    setPwOpen(true);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    if (pw1.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (pw1 !== pw2) {
      setPwError("Passwords don't match.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePayload({ password: pw1 })),
      });
      if (res.ok) {
        setPwOpen(false);
        setMessage("Password updated.");
      } else {
        const data = await res.json();
        setPwError(data.error ?? "Could not update password.");
      }
    } finally {
      setPwSaving(false);
    }
  }

  // Full-page loader only for the initial load — the Save button shows inline
  // dots while saving.
  usePageLoading(!loaded);
  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Edit Profile</h1>
      <Card>
        {/* No Save button: changes persist as you make them — roles save on
            click, name/email on blur. Enter in a text field saves too. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile();
          }}
          className="space-y-4"
        >
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => saveProfile()}
            required
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => saveProfile()}
            placeholder="you@example.com"
          />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Instruments / roles
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_ORDER.map((inst) => (
                <Checkbox
                  key={inst}
                  label={INSTRUMENT_LABELS[inst]}
                  checked={instruments.includes(inst)}
                  onChange={() => toggleInstrument(inst)}
                />
              ))}
            </div>
          </fieldset>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </span>
            {hasPassword ? (
              <Button
                type="button"
                variant="secondary"
                onClick={openPasswordModal}
              >
                Change password
              </Button>
            ) : (
              // Google (OAuth-only) accounts have no password to change.
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" disabled>
                  Change password
                </Button>
                <span className="text-sm text-gray-500">
                  (signed in with Google)
                </span>
              </div>
            )}
          </div>

          {/* Auto-save status: a transient "Saving…"/"Saved ✓", or an error.
              Fixed height so the layout doesn't jump as it changes. */}
          <div className="flex h-5 items-center text-sm font-medium">
            {saving ? (
              <span className="flex items-center gap-2 text-gray-500">
                <LoadingDots size="sm" /> Saving…
              </span>
            ) : message ? (
              <span
                className={
                  message.startsWith("Error") ? "text-red-600" : "text-green-600"
                }
              >
                {message}
              </span>
            ) : saved ? (
              <span className="text-green-600">Saved ✓</span>
            ) : null}
          </div>
        </form>
      </Card>

      <SlackConnections initial={memberships} />

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <form onSubmit={changePassword} className="space-y-4">
          <Input
            label="New password"
            type="password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoComplete="new-password"
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            required
          />
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPwOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pwSaving}>
              {pwSaving ? <LoadingDots size="sm" /> : "Update password"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Per-org Slack linking. Each org the user belongs to gets a row: the current
// member id (connected/not), a one-click Connect button (Flow A OAuth, which
// prefills the workspace), and a manual id field as the fallback.
function SlackConnections({ initial }: { initial: Membership[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => setRows(initial), [initial]);

  async function saveManual(orgId: string) {
    const value = drafts[orgId] ?? "";
    const res = await fetch(`/api/memberships/${orgId}/slack`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackUserId: value || null }),
    });
    if (res.ok) {
      const { slackUserId } = await res.json();
      setRows((rs) => rs.map((r) => (r.orgId === orgId ? { ...r, slackUserId } : r)));
      setDrafts((d) => ({ ...d, [orgId]: "" }));
    }
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Slack</h2>
      <p className="mb-4 text-sm text-gray-500">
        Connect Slack per organization so the bot can DM you about assignments,
        swaps, and availability. Member IDs are different in each workspace.
      </p>
      <div className="space-y-4">
        {rows.map((m) => (
          <div
            key={m.orgId}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{m.orgName}</p>
                <p className="text-xs text-gray-500">
                  {m.slackUserId ? (
                    <span className="text-green-600">Connected ✓ ({m.slackUserId})</span>
                  ) : m.orgSlackConnected ? (
                    "Not connected"
                  ) : (
                    "Slack isn't set up for this org yet"
                  )}
                </p>
              </div>
              {m.orgSlackConnected && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = `/api/slack/connect?orgId=${m.orgId}`;
                  }}
                >
                  {m.slackUserId ? "Reconnect" : "Connect Slack"}
                </Button>
              )}
            </div>
            {/* A member ID is only useful once the org's bot is installed —
                otherwise there's nothing to DM through, so hide the field. */}
            {m.orgSlackConnected && (
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label="Or enter your member ID manually"
                    value={drafts[m.orgId] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [m.orgId]: e.target.value }))
                    }
                    placeholder={m.slackUserId ?? "e.g. U0123ABCDEF"}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => saveManual(m.orgId)}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
