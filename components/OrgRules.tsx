"use client";
// Org settings → Scheduling rules: the org's own instructions to Auto
// schedule, on top of plain rotation. Admin-only, and keyed on orgId by the
// parent so it remounts on an org switch.
//
// Two sections, each with its own count and its own scroll box (an org can
// collect a lot of these): REQUIRED rules, which are never broken, and
// PREFERENCES, a ranked list — drag by the grip or use ↑/↓, and the higher one
// wins when two pull different ways. The vocabulary, the sentences and the
// contradiction check all live in lib/schedulingRules.ts; this only draws them.
//
// Every change PUTs the whole list (required first, then preferences in rank
// order). Toggles, deletes and reorders are optimistic and roll back if the
// API refuses; the builder waits for the save so a refusal stays on screen
// next to the rule it's about.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import Button from "@/components/common/Button";
import InfoTooltip from "@/components/common/InfoTooltip";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import Toggle from "@/components/common/Toggle";
import { DAY_ABBRS } from "@/lib/constants";
import { minutesToShortTimeLabel, shortDateTimeCompact } from "@/lib/dates";
import {
  LIMIT_MAX,
  RULE_KINDS,
  describeRule,
  explainRule,
  findContradiction,
  parseRuleParams,
  ruleSentence,
  type RuleKind,
  type RuleNames,
  type RuleParams,
  type RuleTier,
  type SchedulingRule,
} from "@/lib/schedulingRules";

interface RuleOptions {
  people: { id: string; name: string }[];
  roles: { key: string; label: string }[];
  templates: {
    id: string;
    label: string;
    dayOfWeek: number;
    startMinute: number;
    teamName: string | null;
  }[];
  sets: { id: string; label: string | null; startsAt: string; teamName: string | null }[];
  teams: { id: string; name: string }[];
}

// The builder's form: every blank of every kind, so switching kinds mid-way
// keeps what was already picked where it still applies.
interface Draft {
  kind: RuleKind;
  tier: RuleTier;
  userId: string;
  otherUserId: string;
  role: string;
  scope: "WEEKLY" | "ONCE";
  templateA: string;
  templateB: string;
  setA: string;
  setB: string;
  mode: "ALWAYS" | "NEVER";
  max: number;
  period: "WEEK" | "MONTH";
  // Role-shaped kinds. `roles` is ORDERED — for MD order that order IS the
  // preference, so the chips below record the sequence they were clicked in.
  roles: string[];
  otherRole: string;
  // Which sets this rule governs: "" = the whole org, else a team id.
  teamId: string;
}

const EMPTY_DRAFT: Draft = {
  kind: "PREFER",
  tier: "PREFERENCE",
  userId: "",
  otherUserId: "",
  role: "",
  scope: "WEEKLY",
  templateA: "",
  templateB: "",
  setA: "",
  setB: "",
  mode: "NEVER",
  max: 2,
  period: "MONTH",
  // Role-shaped kinds: an ORDERED list (MD preference order, or the roles a
  // hosted role may sit alongside) and the second half of a pair.
  roles: [],
  otherRole: "",
  teamId: "",
};

// The Draft's stand-in for "no one person" on a Limit rule — a real id is a
// cuid, so this can't collide. Becomes `userId: null` on the way out.
const ALL_PEOPLE = "__ALL__";

function draftFromRule(rule: SchedulingRule): Draft {
  const d: Draft = {
    ...EMPTY_DRAFT,
    kind: rule.params.kind,
    tier: rule.tier,
    teamId: rule.teamId ?? "",
  };
  const p = rule.params;
  switch (p.kind) {
    case "ONLY_IF_NEEDED":
      return { ...d, userId: p.userId, role: p.role ?? "" };
    case "PREFER":
      return { ...d, userId: p.userId, otherUserId: p.otherUserId, role: p.role };
    case "SAME_PLAYER":
      return p.scope === "WEEKLY"
        ? { ...d, role: p.role, scope: "WEEKLY", templateA: p.templateIds[0], templateB: p.templateIds[1] }
        : { ...d, role: p.role, scope: "ONCE", setA: p.setIds[0], setB: p.setIds[1] };
    case "TOGETHER":
      return { ...d, userId: p.userIds[0], otherUserId: p.userIds[1], mode: p.mode };
    case "LIMIT":
      return { ...d, userId: p.userId ?? ALL_PEOPLE, max: p.max, period: p.period };
    case "LEADS_FROM":
      return { ...d, roles: [...p.roles] };
    case "ROLE_HOST":
      return { ...d, role: p.role, roles: [...p.hostRoles] };
    case "MAY_DOUBLE":
      return { ...d, role: p.roles[0], otherRole: p.roles[1] };
  }
}

/** The draft as rule params, or what's still missing / wrong with it. */
function paramsFromDraft(d: Draft): RuleParams | string {
  switch (d.kind) {
    case "ONLY_IF_NEEDED":
      return parseRuleParams({ kind: d.kind, userId: d.userId, role: d.role || null });
    case "PREFER":
      return parseRuleParams({ kind: d.kind, userId: d.userId, otherUserId: d.otherUserId, role: d.role });
    case "SAME_PLAYER":
      return parseRuleParams(
        d.scope === "WEEKLY"
          ? { kind: d.kind, role: d.role, scope: "WEEKLY", templateIds: [d.templateA, d.templateB] }
          : { kind: d.kind, role: d.role, scope: "ONCE", setIds: [d.setA, d.setB] }
      );
    case "TOGETHER":
      return parseRuleParams({ kind: d.kind, userIds: [d.userId, d.otherUserId], mode: d.mode });
    case "LIMIT":
      return parseRuleParams({
        kind: d.kind,
        userId: d.userId === ALL_PEOPLE ? null : d.userId,
        max: d.max,
        period: d.period,
      });
    case "LEADS_FROM":
      return parseRuleParams({ kind: d.kind, roles: d.roles });
    case "ROLE_HOST":
      return parseRuleParams({ kind: d.kind, role: d.role, hostRoles: d.roles });
    case "MAY_DOUBLE":
      return parseRuleParams({ kind: d.kind, roles: [d.role, d.otherRole] });
  }
}

const kindInfo = (kind: RuleKind) => RULE_KINDS.find((k) => k.kind === kind)!;

// Required first, then preferences in rank order — the shape the list is
// always kept in, so a section's own order IS its slice of the array.
const split = (rules: SchedulingRule[]) => ({
  required: rules.filter((r) => r.tier === "REQUIRED"),
  preferences: rules.filter((r) => r.tier === "PREFERENCE"),
});

export default function OrgRules({ orgId }: { orgId: string }) {
  // null = not loaded yet.
  const [rules, setRules] = useState<SchedulingRule[] | null>(null);
  const [options, setOptions] = useState<RuleOptions | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The builder: open with a draft, and the id of the rule being edited (null
  // = adding a new one).
  const [builder, setBuilder] = useState<{ editingId: string | null; draft: Draft } | null>(null);
  const [builderError, setBuilderError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRules(null);
    setError("");
    fetch(`/api/orgs/${orgId}/rules`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError("Could not load the rules.");
          return;
        }
        setRules(data.rules ?? []);
        setOptions(data.options ?? null);
      })
      .catch(() => !cancelled && setError("Could not load the rules."));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const names = useMemo<RuleNames>(() => {
    const people = new Map(options?.people.map((p) => [p.id, p.name]));
    const roles = new Map(options?.roles.map((r) => [r.key, r.label]));
    const templates = new Map(options?.templates.map((t) => [t.id, templateLabel(t)]));
    const sets = new Map(options?.sets.map((s) => [s.id, setLabel(s)]));
    const teams = new Map(options?.teams.map((t) => [t.id, t.name]));
    return {
      team: (id) => teams.get(id) ?? "a team",
      user: (id) => people.get(id) ?? "someone",
      role: (key) => roles.get(key) ?? key,
      template: (id) => templates.get(id) ?? "a recurring set",
      set: (id) => sets.get(id) ?? "a set",
    };
  }, [options]);

  /** Save the whole list. Returns the server's error, or null on success. */
  async function persist(next: SchedulingRule[]): Promise<string | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: next.map((r) => ({
            tier: r.tier,
            enabled: r.enabled,
            params: r.params,
            teamId: r.teamId ?? null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const at = typeof data.index === "number" ? next[data.index] : null;
        return at
          ? `${data.error ?? "Could not save."} (“${ruleSentence(at.params, names)}”)`
          : (data.error ?? "Could not save the rules.");
      }
      setRules(data.rules ?? next);
      return null;
    } catch {
      return "Could not save the rules.";
    } finally {
      setBusy(false);
    }
  }

  // Toggle / delete / reorder: the list moves at once, and goes back if the
  // save is refused.
  async function optimistic(next: SchedulingRule[]) {
    const previous = rules ?? [];
    setRules(next);
    setError("");
    const err = await persist(next);
    if (err) {
      setRules(previous);
      setError(err);
    }
  }

  function toggle(id: string, enabled: boolean) {
    if (!rules) return;
    const next = rules.map((r) => (r.id === id ? { ...r, enabled } : r));
    // Turning a required rule back on can clash with one added while it was off.
    const clash = findContradiction(next);
    if (clash && enabled) {
      setError(`Can't turn that back on: ${clash.message}`);
      return;
    }
    optimistic(next);
  }

  function remove(id: string) {
    if (!rules) return;
    optimistic(rules.filter((r) => r.id !== id));
  }

  function reorderPreferences(from: number, to: number) {
    if (!rules) return;
    const { required, preferences } = split(rules);
    if (to < 0 || to >= preferences.length) return;
    optimistic([...required, ...arrayMove(preferences, from, to)]);
  }

  // The list as it would be with the builder's rule saved: an edit stays where
  // it was unless its tier changed, which moves it to the end of the other
  // section (the bottom of the preference ranking, if it became one).
  function withDraft(
    params: RuleParams,
    tier: RuleTier,
    teamId: string | null = null
  ): SchedulingRule[] {
    const list = rules ?? [];
    const id = builder?.editingId ?? "new";
    const current = list.find((r) => r.id === id);
    const rule: SchedulingRule = {
      id,
      tier,
      enabled: current?.enabled ?? true,
      params,
      teamId,
    };
    if (current && current.tier === tier) {
      return list.map((r) => (r.id === id ? rule : r));
    }
    const { required, preferences } = split(list.filter((r) => r.id !== id));
    return tier === "REQUIRED"
      ? [...required, rule, ...preferences]
      : [...required, ...preferences, rule];
  }

  async function saveBuilder(
    params: RuleParams,
    tier: RuleTier,
    teamId: string | null
  ) {
    setBuilderError("");
    const err = await persist(withDraft(params, tier, teamId));
    if (err) {
      setBuilderError(err);
      return;
    }
    setError("");
    setBuilder(null);
  }

  if (rules === null) {
    return (
      <div>
        <Heading />
        <p className="text-sm text-gray-400">{error || "Loading…"}</p>
      </div>
    );
  }

  const { required, preferences } = split(rules);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !options}
          onClick={() => {
            setBuilderError("");
            setBuilder({ editingId: null, draft: EMPTY_DRAFT });
          }}
        >
          + Add rule
        </Button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <RuleSection
        title="Required"
        hint="Never broken. If one can't be met, the slot stays open for you to fill by hand."
        count={required.length}
        empty="No required rules yet."
      >
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {required.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              names={names}
              busy={busy}
              onToggle={(on) => toggle(rule.id, on)}
              onEdit={() => {
                setBuilderError("");
                setBuilder({ editingId: rule.id, draft: draftFromRule(rule) });
              }}
              onDelete={() => remove(rule.id)}
            />
          ))}
        </ul>
      </RuleSection>

      <RuleSection
        title="Preferences"
        hint="Followed when possible. Ranked: when two pull different ways, the higher one wins. Every preference outranks plain rotation."
        count={preferences.length}
        empty="No preferences yet."
      >
        <PreferenceList
          rules={preferences}
          names={names}
          busy={busy}
          onMove={reorderPreferences}
          onToggle={toggle}
          onEdit={(rule) => {
            setBuilderError("");
            setBuilder({ editingId: rule.id, draft: draftFromRule(rule) });
          }}
          onDelete={remove}
        />
      </RuleSection>

      {builder && options && (
        <RuleBuilder
          editing={builder.editingId !== null}
          draft={builder.draft}
          options={options}
          names={names}
          busy={busy}
          error={builderError}
          prospective={withDraft}
          onChange={(draft) => setBuilder({ ...builder, draft })}
          onClose={() => setBuilder(null)}
          onSave={saveBuilder}
        />
      )}
    </div>
  );
}

function Heading() {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-sm font-medium">Scheduling rules</p>
        <InfoTooltip text="Auto schedule normally rotates people fairly. Rules let you steer it: who to pick first, who to keep together or apart, who plays both of two sets, and how often someone serves. They apply to every team in this org. Picking people by hand is never blocked." />
      </div>
      <p className="text-sm text-gray-500">How Auto schedule picks people.</p>
    </div>
  );
}

// A titled section with its own count and its own scroll box, so a long list
// of one tier never pushes the other off the page.
function RuleSection({
  title,
  hint,
  count,
  empty,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <header className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title} ({count})
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </header>
      {count === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto overscroll-contain" data-no-pull>
          {children}
        </div>
      )}
    </section>
  );
}

function Sentence({ params, names }: { params: RuleParams; names: RuleNames }) {
  return (
    <>
      {describeRule(params, names).map((part, i) =>
        part.strong ? (
          <strong key={i} className="font-semibold text-gray-900 dark:text-gray-100">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

// The row body both sections share: switch, sentence, Edit, Delete.
function RuleRowBody({
  rule,
  names,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: SchedulingRule;
  names: RuleNames;
  busy: boolean;
  onToggle: (on: boolean) => void;
  // Absent for a rule with no builder form (see CREATABLE_KINDS) — those are
  // changed by switching them off or deleting them.
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const sentence = ruleSentence(rule.params, names);
  // Wide: switch · sentence · Edit/Delete on one line. Phone: the sentence
  // gets the whole width and the controls sit under it — `sm:contents` lifts
  // them back into the row, `order` puts the switch first.
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <p
        className={`min-w-0 text-sm text-gray-600 sm:order-2 sm:flex-1 dark:text-gray-300 ${
          rule.enabled ? "" : "line-through opacity-50"
        }`}
      >
        <Sentence params={rule.params} names={names} />
        {rule.teamId && (
          // Only a SCOPED rule is badged: org-wide is the default, and badging
          // every row would make the exception harder to spot, not easier.
          <span className="ml-2 whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {names.team(rule.teamId)} only
          </span>
        )}
      </p>
      <div className="flex items-center gap-1 sm:contents">
        <span className="mr-auto flex sm:order-1 sm:mr-0">
          <Toggle
            checked={rule.enabled}
            onChange={onToggle}
            label={`${rule.enabled ? "Turn off" : "Turn on"}: ${sentence}`}
            hideLabel
            disabled={busy}
          />
        </span>
        <div className="flex shrink-0 gap-1 sm:order-3">
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
              Edit
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete: ${sentence}`}
            className="!text-red-600 dark:!text-red-400"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function RuleRow(props: Parameters<typeof RuleRowBody>[0]) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <RuleRowBody {...props} />
    </li>
  );
}

function PreferenceList({
  rules,
  names,
  busy,
  onMove,
  onToggle,
  onEdit,
  onDelete,
}: {
  rules: SchedulingRule[];
  names: RuleNames;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onToggle: (id: string, on: boolean) => void;
  onEdit: (rule: SchedulingRule) => void;
  onDelete: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = rules.findIndex((r) => r.id === active.id);
    const to = rules.findIndex((r) => r.id === over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {rules.map((rule, i) => (
            <SortablePreferenceRow
              key={rule.id}
              rank={i + 1}
              rule={rule}
              names={names}
              busy={busy}
              isFirst={i === 0}
              isLast={i === rules.length - 1}
              onUp={() => onMove(i, i - 1)}
              onDown={() => onMove(i, i + 1)}
              onToggle={(on) => onToggle(rule.id, on)}
              onEdit={() => onEdit(rule)}
              onDelete={() => onDelete(rule.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

// One ranked preference: rank, grip (drag), ↑/↓ (for anyone who'd rather not
// drag, and for a long list where the target is off-screen), then the row.
function SortablePreferenceRow({
  rank,
  isFirst,
  isLast,
  onUp,
  onDown,
  ...row
}: Parameters<typeof RuleRowBody>[0] & {
  rank: number;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.rule.id,
    disabled: row.busy,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };
  const arrow =
    "flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 " +
    "disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-700";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="relative flex items-center gap-2 bg-white px-3 py-2 dark:bg-gray-800"
    >
      {/* See TeamRolesEditor: a <span> because dnd-kit's attributes already
          make it a button, and touch-none so a touch drag isn't a scroll. */}
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag preference ${rank} to reorder`}
        className="flex shrink-0 cursor-grab touch-none items-center text-gray-400
          hover:text-gray-600 focus:outline-none focus-visible:text-indigo-600
          active:cursor-grabbing dark:hover:text-gray-200"
      >
        <GripIcon />
      </span>
      <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-gray-400">
        {rank}
      </span>
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          className={arrow}
          disabled={isFirst || row.busy}
          onClick={onUp}
          aria-label={`Move preference ${rank} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className={arrow}
          disabled={isLast || row.busy}
          onClick={onDown}
          aria-label={`Move preference ${rank} down`}
        >
          ↓
        </button>
      </div>
      <RuleRowBody {...row} />
    </li>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <circle cx="6" cy="5" r="1.6" />
      <circle cx="10" cy="5" r="1.6" />
      <circle cx="6" cy="11" r="1.6" />
      <circle cx="10" cy="11" r="1.6" />
    </svg>
  );
}

// ── The builder ───────────────────────────────────────────────────────────

const templateLabel = (t: RuleOptions["templates"][number]) =>
  `${t.label} (${DAY_ABBRS[t.dayOfWeek]} ${minutesToShortTimeLabel(t.startMinute)})`;

const setLabel = (s: RuleOptions["sets"][number]) =>
  `${s.label || s.teamName || "Set"} ${shortDateTimeCompact(s.startsAt)}`;

// Three steps on one screen: 1 what kind, 2 the sentence (its blanks are the
// dropdowns), 3 required or preference. Below them, in words, what the rule
// will make Auto schedule do — and, if it would clash with a required rule
// already on the list, why it can't be saved.
function RuleBuilder({
  editing,
  draft,
  options,
  names,
  busy,
  error,
  prospective,
  onChange,
  onClose,
  onSave,
}: {
  editing: boolean;
  draft: Draft;
  options: RuleOptions;
  names: RuleNames;
  busy: boolean;
  error: string;
  prospective: (
    params: RuleParams,
    tier: RuleTier,
    teamId: string | null
  ) => SchedulingRule[];
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: (params: RuleParams, tier: RuleTier, teamId: string | null) => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const info = kindInfo(draft.kind);
  // ONLY_IF_NEEDED can only be a preference.
  const tier: RuleTier = info.tiers.includes(draft.tier) ? draft.tier : info.tiers[0];
  const params = paramsFromDraft(draft);
  const ready = typeof params !== "string";
  const clash = ready
    ? findContradiction(prospective(params, tier, draft.teamId || null))
    : null;

  // `everyone` adds the org-wide option a Limit rule can take (userId null).
  const person = (
    value: string,
    onPick: (id: string) => void,
    label: string,
    exclude?: string,
    everyone = false
  ) => (
    <Blank>
      <Select label={label} hideLabel value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="">Pick a person…</option>
        {everyone && <option value={ALL_PEOPLE}>Everyone</option>}
        {options.people
          .filter((p) => p.id !== exclude)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
    </Blank>
  );
  const role = (allowAny = false) => (
    <Blank>
      <Select label="Role" hideLabel value={draft.role} onChange={(e) => set({ role: e.target.value })}>
        <option value="">{allowAny ? "any role" : "Pick a role…"}</option>
        {options.roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </Select>
    </Blank>
  );
  // The left column's filter. Matches title and description, so "md" finds
  // "Who can lead" by its wording rather than only by name.
  const [kindQuery, setKindQuery] = useState("");
  const matchingKinds = RULE_KINDS.filter((k) => {
    const q = kindQuery.trim().toLowerCase();
    return !q || `${k.title} ${k.description}`.toLowerCase().includes(q);
  });

  // An ORDERED multi-pick: click to add (appending), click again to drop.
  // A plain multi-select can't express order, and order is the whole point of
  // MD preference — so each chosen role shows its position.
  const roleList = (label: string) => (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {options.roles.map((r) => {
        const at = draft.roles.indexOf(r.key);
        const picked = at >= 0;
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={picked}
            aria-label={`${label}: ${r.label}`}
            onClick={() =>
              set({
                roles: picked
                  ? draft.roles.filter((k) => k !== r.key)
                  : [...draft.roles, r.key],
              })
            }
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              picked
                ? "border-indigo-500 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
                : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {picked && <span className="mr-1 opacity-60">{at + 1}.</span>}
            {r.label}
          </button>
        );
      })}
    </span>
  );
  // The second role of a pair — `role` holds the first.
  const otherRole = () => (
    <Blank>
      <Select
        label="Other role"
        hideLabel
        value={draft.otherRole}
        onChange={(e) => set({ otherRole: e.target.value })}
      >
        <option value="">Pick a role…</option>
        {options.roles
          .filter((r) => r.key !== draft.role)
          .map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
      </Select>
    </Blank>
  );
  // One line of the form: the glue word, then its control, with every word
  // column the same width so stacked rows line their controls up. This is what
  // makes a two-person rule read as a balanced pair.
  const line = (word: string, control: React.ReactNode, after?: string) => (
    <div className="flex w-full items-center gap-2">
      <span className="w-14 shrink-0 text-right text-sm text-gray-500 dark:text-gray-400">
        {word}
      </span>
      {control}
      {after && (
        <span className="text-sm text-gray-500 dark:text-gray-400">{after}</span>
      )}
    </div>
  );

  let sentence: React.ReactNode;
  switch (draft.kind) {
    case "ONLY_IF_NEEDED":
      sentence = (
        <>
          {person(draft.userId, (userId) => set({ userId }), "Person", undefined, true)}
          <T>is seated on</T>
          {role(true)}
          <T>only if nobody else is free</T>
        </>
      );
      break;
    case "PREFER":
      sentence = (
        <>
          {line(
            "Pick",
            person(draft.userId, (userId) => set({ userId }), "First choice", draft.otherUserId)
          )}
          {line(
            "over",
            person(
              draft.otherUserId,
              (otherUserId) => set({ otherUserId }),
              "Second choice",
              draft.userId
            )
          )}
          {line("on", role())}
        </>
      );
      break;
    case "SAME_PLAYER": {
      const weekly = draft.scope === "WEEKLY";
      const pick = (value: string, key: "templateA" | "templateB" | "setA" | "setB", other: string) => (
        <Blank>
          <Select
            label={weekly ? "Recurring set" : "Set"}
            hideLabel
            value={value}
            onChange={(e) => set({ [key]: e.target.value })}
          >
            <option value="">{weekly ? "Pick a recurring set…" : "Pick a set…"}</option>
            {weekly
              ? options.templates
                  .filter((t) => t.id !== other)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {templateLabel(t)}
                      {t.teamName ? ` · ${t.teamName}` : ""}
                    </option>
                  ))
              : options.sets
                  .filter((s) => s.id !== other)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {setLabel(s)}
                    </option>
                  ))}
          </Select>
        </Blank>
      );
      sentence = (
        <>
          <div className="mb-1 flex w-full gap-1" role="radiogroup" aria-label="Which sets">
            <Choice selected={weekly} onClick={() => set({ scope: "WEEKLY" })}>
              Every week
            </Choice>
            <Choice selected={!weekly} onClick={() => set({ scope: "ONCE" })}>
              Specific dates
            </Choice>
          </div>
          {weekly
            ? pick(draft.templateA, "templateA", draft.templateB)
            : pick(draft.setA, "setA", draft.setB)}
          <T>and</T>
          {weekly
            ? pick(draft.templateB, "templateB", draft.templateA)
            : pick(draft.setB, "setB", draft.setA)}
          <T>{weekly ? "in the same week share their" : "share their"}</T>
          {role()}
          <T>player</T>
          {weekly && options.templates.length < 2 && (
            <p className="w-full text-xs text-amber-600 dark:text-amber-400">
              This needs two recurring sets. Add them on the Create tab first.
            </p>
          )}
        </>
      );
      break;
    }
    case "TOGETHER":
      sentence = (
        <>
          {line(
            "",
            person(draft.userId, (userId) => set({ userId }), "First person", draft.otherUserId)
          )}
          {line(
            "and",
            person(
              draft.otherUserId,
              (otherUserId) => set({ otherUserId }),
              "Second person",
              draft.userId
            )
          )}
          {line(
            "",
            <Blank>
              <Select
                label="Always or never"
                hideLabel
                value={draft.mode}
                onChange={(e) => set({ mode: e.target.value as Draft["mode"] })}
              >
                <option value="NEVER">never</option>
                <option value="ALWAYS">always</option>
              </Select>
            </Blank>,
            "serve on the same set"
          )}
        </>
      );
      break;
    case "LEADS_FROM":
      sentence = (
        <>
          <T>A musical director leads from</T>
          {roleList("Leads from")}
          <T>— click them in order of preference</T>
        </>
      );
      break;
    case "ROLE_HOST":
      sentence = (
        <>
          {role()}
          <T>is only played by someone already on</T>
          {roleList("Doubles up with")}
        </>
      );
      break;
    case "MAY_DOUBLE":
      sentence = (
        <>
          {role()}
          <T>and</T>
          {otherRole()}
          <T>can be played by the same person</T>
        </>
      );
      break;
    case "LIMIT":
      sentence = (
        <>
          {person(draft.userId, (userId) => set({ userId }), "Person", undefined, true)}
          <T>plays at most</T>
          <Blank narrow>
            <Select
              label="How many sets"
              hideLabel
              value={draft.max}
              onChange={(e) => set({ max: Number(e.target.value) })}
            >
              {Array.from({ length: LIMIT_MAX }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Blank>
          <T>{draft.max === 1 ? "set a" : "sets a"}</T>
          <Blank narrow>
            <Select
              label="Week or month"
              hideLabel
              value={draft.period}
              onChange={(e) => set({ period: e.target.value as Draft["period"] })}
            >
              <option value="WEEK">week</option>
              <option value="MONTH">month</option>
            </Select>
          </Blank>
        </>
      );
      break;
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={editing ? "Edit rule" : "Add a rule"}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            loading={busy}
            disabled={!ready || !!clash}
            onClick={() => ready && onSave(params, tier, draft.teamId || null)}
          >
            {editing ? "Save rule" : "Add rule"}
          </Button>
        </div>
      }
    >
      {/* Lets a host modal know this third layer is up, so it leaves Escape to
          this dialog (see StagedScheduleModal's rules guard). A real node
          because Modal only forwards the props it declares. */}
      <span data-rule-builder hidden />

      {/* Two columns: WHICH rule on the left, WHAT IT SAYS on the right. The
          kinds are a fixed vocabulary you scan and filter, while everything to
          the right only makes sense once one is picked — stacked, the blanks
          you came to fill sat below a grid you'd already finished with. One
          column on a phone, where side-by-side would squeeze both. */}
      <div className="grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium">What kind of rule?</p>
          <Input
            label="Search rule kinds"
            hideLabel
            value={kindQuery}
            onChange={(e) => setKindQuery(e.target.value)}
            placeholder="Search…"
            autoComplete="off"
          />
          {/* Scrolls on its own so a long list never pushes the blanks on the
              right out of view. */}
          <div className="mt-2 max-h-[22rem] space-y-1 overflow-y-auto overscroll-contain pr-1">
            {matchingKinds.length === 0 && (
              <p className="px-1 py-2 text-xs text-gray-400">No rule kinds match.</p>
            )}
            {matchingKinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => set({ kind: k.kind })}
                aria-pressed={draft.kind === k.kind}
                className={`block w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  draft.kind === k.kind
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                }`}
              >
                <span className="flex items-center justify-between gap-1.5">
                  <span className="text-sm font-medium">{k.title}</span>
                  <InfoTooltip text={k.description} />
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">

      <p className="mb-2 text-sm font-medium">Fill in the blanks</p>
      {/* `items-baseline` keeps the glue words sitting on the controls' text
          rather than floating mid-box, and the blanks share one width (see
          Blank) so two people read as a balanced pair instead of a ragged
          sentence that rewraps as you pick. */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-2 gap-y-3">
        {sentence}
      </div>

      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        Applies to
        <InfoTooltip text="Which sets this rule governs. A team's rule is simply not consulted when filling another team's set — so two teams can hold opposite rules and both are honoured." />
      </p>
      <div className="mb-5 w-full sm:w-64">
        <Select
          label="Applies to"
          hideLabel
          value={draft.teamId}
          onChange={(e) => set({ teamId: e.target.value })}
        >
          <option value="">Every team in this org</option>
          {options.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} only
            </option>
          ))}
        </Select>
      </div>

      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        How strict?
        <InfoTooltip text="Required rules are never broken — if one can't be met the slot is left open for you to fill by hand. Preferences bend: they're ranked, the higher one wins when two disagree, and all of them outrank plain rotation." />
      </p>
      <div className="mb-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TierCard
            selected={tier === "REQUIRED"}
            disabled={!info.tiers.includes("REQUIRED")}
            onClick={() => set({ tier: "REQUIRED" })}
            title="Required"
            body={
              info.tiers.includes("REQUIRED")
                ? "Never broken. If it can't be met, the slot stays open."
                : "Not for this kind: a required last resort would just mean never. Mark them inactive instead."
            }
          />
          <TierCard
            selected={tier === "PREFERENCE"}
            disabled={!info.tiers.includes("PREFERENCE")}
            onClick={() => set({ tier: "PREFERENCE" })}
            title="Preference"
            body={
              !info.tiers.includes("PREFERENCE")
                ? "Not for this kind: it describes what a role IS, so there's nothing for \u201cwhen possible\u201d to mean."
                : editing
                  ? "Followed when possible. Keeps its place in the ranking."
                  : "Followed when possible. Added at the bottom of the ranking; drag it up to give it more weight."
            }
          />
        </div>
      </div>

      {ready ? (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            What this does
          </p>
          <p className="text-gray-700 dark:text-gray-300">{explainRule(params, tier, names)}</p>
        </div>
      ) : (
        <p className="text-sm text-gray-400">{params}</p>
      )}

      {clash && (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {clash.message} Change it, or make it a preference.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
        </div>
      </div>
    </Modal>
  );
}


// The sentence's glue words between its blanks.
function T({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-gray-600 dark:text-gray-300">{children}</span>;
}

// One blank in the sentence. Select fills its wrapper, so the width lives here.
function Blank({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <div className={narrow ? "w-24" : "w-full sm:w-52"}>{children}</div>;
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        selected
          ? "bg-indigo-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

function TierCard({
  selected,
  disabled = false,
  onClick,
  title,
  body,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
      }`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{body}</p>
    </button>
  );
}
