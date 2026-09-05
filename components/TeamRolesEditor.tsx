"use client";
// A team's role catalog, edited in place: what roles this team has, how many of
// each a set wants by default, which are admin-only, and — by dragging a row by
// its grip handle — what ORDER they come in. Lives in the team management
// modal, since a team's roles are as much a part of it as its roster.
//
// The order isn't cosmetic to this editor alone: a role's position here IS its
// `order`, and every roster in the app (set detail, the create/capacity forms,
// the schedule grid, Slack summaries) renders roles through
// `orderedRoles`/`slottedRoles`, which sort by it. It's also the auto-fill's
// order — the scheduler seats roles top-down, so scarce/hard-to-fill roles
// belong near the top where they get first pick of people.
//
// The whole list is saved at once (PUT /api/teams/:id/roles) — that's what lets
// a rename, a re-count and a deletion travel together. A role the admin removes
// only actually goes if nobody holds it on an upcoming set; the server answers
// 409 with the offending slots and they're listed here so the admin knows where
// to go.
import { useEffect, useState, type CSSProperties } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

  // The saved catalog as a comparable string. Used both to decide when to
  // reseed the editor and to tell whether it has unsaved edits.
  const savedRoles = orderedRoles(roles).map(toDraft);
  const savedKey = JSON.stringify(savedRoles.map(({ uid: _uid, ...r }) => r));

  // Reseed on a different team, or when the saved catalog's CONTENT changes
  // (our own save landing, or someone else's edit). Deliberately not on the
  // `roles` array's identity: the page refetches teams in the background, and
  // keying on the prop threw away whatever the admin was in the middle of —
  // including, mid-drag, the focus the keyboard sensor was holding.
  useEffect(() => {
    setDraft(orderedRoles(roles).map(toDraft));
    setError(null);
    setBlockers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, savedKey]);

  const patch = (uid: string, next: Partial<RoleDraft>) =>
    setDraft((rows) =>
      rows.map((r) => (r.uid === uid ? { ...r, ...next } : r))
    );

  // Drop a dragged row into its new place. Position in this list is the saved
  // `order`, so this is the whole of "reordering" — nothing else to track.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((rows) => {
      const from = rows.findIndex((r) => r.uid === active.id);
      const to = rows.findIndex((r) => r.uid === over.id);
      if (from < 0 || to < 0) return rows;
      return arrayMove(rows, from, to);
    });
  };

  // A small activation distance so clicking the grip (or tabbing to it) doesn't
  // start a drag; the keyboard sensor is what replaces the old ▲▼ buttons —
  // space lifts a row, the arrow keys move it, space drops it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Unsaved until the draft matches what came back from the server.
  const dirty = JSON.stringify(draft.map(({ uid: _uid, ...r }) => r)) !== savedKey;

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
        set asks for — an individual set can still override its own shape. Drag a
        role by its handle to reorder: this is the order rosters read in
        everywhere, and the order auto-schedule fills them, so put hard-to-staff
        roles near the top.
      </p>

      {/* Drag a role by its grip to reorder. Only the handle carries the drag
          listeners, so the name/count inputs stay fully editable and a touch
          drag doesn't fight the modal's scroll (dnd-kit pointer sensor). */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={draft.map((r) => r.uid)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-1.5">
            {draft.map((role) => (
              <SortableRoleRow
                key={role.uid}
                role={role}
                busy={busy}
                onPatch={(next) => patch(role.uid, next)}
                onRemove={() =>
                  setDraft((rows) => rows.filter((r) => r.uid !== role.uid))
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

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

// One draggable role row. The drag listeners live only on the grip handle so
// the name/count inputs stay usable; dnd-kit's transform/transition animate the
// row while it's being sorted.
function SortableRoleRow({
  role,
  busy,
  onPatch,
  onRemove,
}: {
  role: RoleDraft;
  busy: boolean;
  onPatch: (next: Partial<RoleDraft>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: role.uid });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the row above its siblings while it's being dragged.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };

  // A set has one MD at most, so its count is capped at one — that cap is
  // exactly what keeps the rest of the app free of "which MD?" handling.
  const maxCount = role.key === MD_KEY ? MAX_MDS_PER_SET : MAX_SLOTS_PER_ROLE;

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2">
      {/* A <span>, not a <button>: dnd-kit's `attributes` already give it
          role="button" and a tab stop, and a real button's own Space handling
          fights the keyboard sensor for the same key. `touch-none` lets the
          pointer sensor own touch gestures instead of the browser scrolling the
          modal out from under the drag. */}
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag ${role.label || "role"} to reorder`}
        className="flex shrink-0 cursor-grab touch-none items-center text-gray-400
          hover:text-gray-600 focus:outline-none focus-visible:text-indigo-600
          active:cursor-grabbing dark:hover:text-gray-200"
      >
        <GripIcon />
      </span>
      <input
        value={role.label}
        onChange={(e) => onPatch({ label: e.target.value })}
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
          onPatch({
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
          onChange={(e) => onPatch({ adminOnly: e.target.checked })}
        />
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${role.label || "role"}`}
        title="Remove role"
        disabled={busy}
        className="shrink-0 rounded p-1 text-xs leading-none text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-red-400"
      >
        ✕
      </button>
    </li>
  );
}

// Four-dot grab handle: the affordance that says a row can be picked up and
// moved, in place of the ▲▼ nudges this list used to carry.
function GripIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <circle cx="6" cy="5" r="1.6" />
      <circle cx="10" cy="5" r="1.6" />
      <circle cx="6" cy="11" r="1.6" />
      <circle cx="10" cy="11" r="1.6" />
    </svg>
  );
}
