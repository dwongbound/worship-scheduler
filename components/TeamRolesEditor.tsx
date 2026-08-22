"use client";
// A team's role catalog, edited in place: what roles this team has, how many of
// each a set wants by default, and which are admin-only. Lives in the team
// management modal, since a team's roles are as much a part of it as its roster.
//
// The whole list is saved at once (PUT /api/teams/:id/roles) — that's what lets
// a rename, a re-count and a deletion travel together. A role the admin removes
// only actually goes if nobody holds it on an upcoming set; the server answers
// 409 with the offending slots and they're listed here so the admin knows where
// to go.
import { useEffect, useState } from "react";
import Button from "./common/Button";
import Checkbox from "./common/Checkbox";
import LoadingDots from "./common/LoadingDots";
import { MAX_SLOTS_PER_ROLE } from "@/lib/constants";
import {
  MAX_MDS_PER_SET,
  MD_KEY,
  orderedRoles,
  type TeamRoleDef,
} from "@/lib/teamRoles";

// One row being edited. `key` is absent for a role the admin just added — the
// server derives it from the name — and present for an existing one, which is
// how a rename keeps every slot pointing at the same role.
interface RoleDraft {
  key?: string;
  label: string;
  defaultCount: number;
  adminOnly: boolean;
  // Local-only React key, so rows stay identified while the name is half-typed.
  uid: string;
}

// One filled slot standing in the way of a deletion.
interface Blocker {
  role: string;
  user: string;
  set: string;
  date: string;
}

function toDraft(role: TeamRoleDef): RoleDraft {
  return {
    key: role.key,
    label: role.label,
    defaultCount: role.defaultCount,
    adminOnly: role.adminOnly,
    uid: role.key,
  };
}

export default function TeamRolesEditor({
  teamId,
  roles,
  onSaved,
}: {
  teamId: string;
  roles: TeamRoleDef[];
  // Parent refetches teams so every set form, roster and picker sees the change.
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RoleDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  // Reseed whenever a different team opens (or its saved catalog changes).
  useEffect(() => {
    setDraft(orderedRoles(roles).map(toDraft));
    setError(null);
    setBlockers([]);
  }, [teamId, roles]);

  const patch = (uid: string, next: Partial<RoleDraft>) =>
    setDraft((rows) =>
      rows.map((r) => (r.uid === uid ? { ...r, ...next } : r))
    );

  // Unsaved until the draft matches what came back from the server.
  const dirty =
    JSON.stringify(draft.map(({ uid: _uid, ...r }) => r)) !==
    JSON.stringify(orderedRoles(roles).map(toDraft).map(({ uid: _uid, ...r }) => r));

  async function save() {
    setBusy(true);
    setError(null);
    setBlockers([]);
    try {
      const res = await fetch(`/api/teams/${teamId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: draft.map(({ uid: _uid, ...role }) => role),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't save the roles.");
        setBlockers(Array.isArray(data.blocking) ? data.blocking : []);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Roles ({draft.length})
      </p>
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        What this team can be staffed with. The count is how many of each a new
        set asks for — an individual set can still override its own shape.
      </p>

      <ul className="space-y-1.5">
        {draft.map((role) => {
          // A set has one MD at most, so its count is capped at one — that cap
          // is exactly what keeps the rest of the app free of "which MD?"
          // handling.
          const maxCount = role.key === MD_KEY ? MAX_MDS_PER_SET : MAX_SLOTS_PER_ROLE;
          return (
          <li key={role.uid} className="flex items-center gap-2">
            <input
              value={role.label}
              onChange={(e) => patch(role.uid, { label: e.target.value })}
              placeholder="Role name"
              aria-label="Role name"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
            />
            <input
              type="number"
              min={0}
              max={maxCount}
              value={role.defaultCount}
              onChange={(e) =>
                patch(role.uid, {
                  defaultCount: Math.max(
                    0,
                    Math.min(maxCount, Math.floor(Number(e.target.value) || 0))
                  ),
                })
              }
              aria-label={`How many ${role.label || "of this role"}`}
              title="How many a set wants by default"
              disabled={busy}
              className="w-14 shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800"
            />
            {/* Admin-only: the person can't tick this for themselves in their
                profile — an admin grants it, exactly like MD. */}
            <span className="shrink-0">
              <Checkbox
                label="Admin-only"
                checked={role.adminOnly}
                disabled={busy}
                onChange={(e) => patch(role.uid, { adminOnly: e.target.checked })}
              />
            </span>
            <button
              type="button"
              onClick={() =>
                setDraft((rows) => rows.filter((r) => r.uid !== role.uid))
              }
              aria-label={`Remove ${role.label || "role"}`}
              title="Remove role"
              disabled={busy}
              className="shrink-0 rounded p-1 text-xs leading-none text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-red-400"
            >
              ✕
            </button>
          </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            setDraft((rows) => [
              ...rows,
              {
                label: "",
                defaultCount: 1,
                adminOnly: false,
                uid: `new-${Date.now()}-${rows.length}`,
              },
            ])
          }
        >
          + Add role
        </Button>
        {dirty && (
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Save roles"}
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {blockers.length > 0 && (
        // Exactly which slots are in the way, so the admin can go clear them.
        <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
          {blockers.map((b, i) => (
            <li key={i}>
              {b.user} — {b.role} on {b.set} ({b.date})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
