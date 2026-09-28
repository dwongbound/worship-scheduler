"use client";
// The "Auto schedule" options step. Everything the generate run needs is asked
// here, in one dialog, rather than sitting permanently on the Create page:
// which window to schedule, and which recurring sets to expand into it.
//
// It only COLLECTS options — the caller runs POST /api/admin/generate and then
// opens StagedScheduleModal on the result, so this dialog stays free of
// fetching and of the plan itself.
//
// Each ticked recurring set also gets an optional COLOUR (none by default),
// which tints that set type's cards in the preview modal. It's a reading aid
// for the review step only — nothing colour-related is ever saved.
import { useEffect, useRef, useState } from "react";
import Button from "./common/Button";
import DateSelect from "./common/DateSelect";
import InfoTooltip from "./common/InfoTooltip";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import Select from "./common/Select";
import SetTypePicker, { type SetTypeColors } from "./SetTypePicker";
import Stepper from "./common/Stepper";
import { DAY_ABBRS } from "@/lib/constants";
import { minutesToShortTimeLabel, shortRangeLabel } from "@/lib/dates";
import type { ApiAvailabilityRequest, ApiSetTemplate } from "@/lib/types";

/** What the caller posts to /api/admin/generate. */
export interface GenerateOptions {
  weeks?: number;
  startDate?: string;
  endDate?: string;
  requestId?: string;
  // Omitted when every template is picked — the endpoint reads "all" from an
  // absent list, so the common case sends nothing extra.
  templateIds?: string[];
}

/** templateId → "#rrggbb". Absent = that set type isn't tinted. */
export type TemplateColors = SetTypeColors;

export default function GenerateModal({
  open,
  templates,
  requests,
  busy,
  error,
  onGenerate,
  onClose,
}: {
  open: boolean;
  templates: ApiSetTemplate[];
  requests: ApiAvailabilityRequest[];
  busy: boolean;
  // Message from a failed run, shown in place so the dialog stays open.
  error: string;
  // Colours ride alongside the options rather than inside them: they're a
  // preview-only reading aid and never reach the API.
  onGenerate: (opts: GenerateOptions, colors: TemplateColors) => void;
  onClose: () => void;
}) {
  // Scope: N weeks ahead from now, an explicit range, or the span of a named
  // availability request (so you schedule exactly what you asked the team
  // about).
  const [mode, setMode] = useState<"weeks" | "range" | "request">("weeks");
  const [weeks, setWeeks] = useState(12); // ~3 months
  const [requestId, setRequestId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Which recurring sets to expand. Everything is ticked on open — scheduling
  // all of them is the usual intent, and unticking is the deliberate act.
  const [picked, setPicked] = useState<string[]>([]);
  // Preview tint per recurring set. Starts empty — no colour is the default.
  const [colors, setColors] = useState<TemplateColors>({});
  // "Everything ticked" is the OPENING state, not a standing rule.
  //
  // Two things make that subtle. The caller rebuilds this array on every
  // render, so the effect is keyed on the list's CONTENTS (templateKey) rather than
  // its identity. And the contents legitimately change while the dialog is
  // open — the list starts with just "Other" and grows a row per recurring set
  // when that fetch lands — which used to re-tick everything and wipe an
  // untick the admin had already made. So once they've touched the picks, we
  // keep them and only drop ids that no longer exist.
  const templateKey = templates.map((t) => t.id).join("|");
  const touched = useRef(false);
  useEffect(() => {
    if (open) touched.current = false;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (touched.current) {
      setPicked((prev) =>
        prev.filter((id) => templates.some((t) => t.id === id))
      );
      return;
    }
    setPicked(templates.map((t) => t.id));
    // templates is deliberately not a dep — templateKey stands in for its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateKey]);

  // Any pick the admin makes themselves is theirs to keep.
  const choosePicked = (next: string[]) => {
    touched.current = true;
    setPicked(next);
  };
  // Colours are a per-run choice, so a fresh dialog starts uncoloured.
  useEffect(() => {
    if (open) setColors({});
  }, [open]);

  if (!open) return null;

  const request = requests.find((r) => r.id === requestId) ?? null;
  const allPicked = picked.length === templates.length;
  // What's missing before this can run — also the button's tooltip, so a
  // disabled button always says why.
  const blocked =
    templates.length === 0
      ? "Add a weekly recurring set first."
      : picked.length === 0
        ? "Pick at least one recurring set."
        : mode === "range" && (!start || !end)
          ? "Pick both a start and end date."
          : mode === "request" && !requestId
            ? "Pick an availability request."
            : null;

  const submit = () =>
    onGenerate(
      {
        ...(mode === "range"
          ? { startDate: start, endDate: end }
          : mode === "request"
            ? { requestId }
            : { weeks }),
        // All of them = say nothing, which is what the endpoint defaults to.
        ...(allPicked ? {} : { templateIds: picked }),
      },
      // Only the sets actually being scheduled carry a colour into the review.
      Object.fromEntries(
        picked.flatMap((id) => (colors[id] ? [[id, colors[id]] as const] : []))
      )
    );

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Auto schedule"
      // The caveat that used to sit beside the title as muted text. It's
      // reassurance, not instruction — nobody needs it on screen every time —
      // so it lives behind the (i) and the header stays a header.
      titleAccessory={
        <InfoTooltip
          text="Nothing is saved until you review and apply the preview."
          // The title sits at the top of the viewport, where an upward bubble
          // would be cut off by the window edge.
          side="bottom"
        />
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !!blocked} title={blocked ?? undefined}>
            {busy ? <LoadingDots size="sm" /> : "Generate preview"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ── When ─────────────────────────────────────────────────── */}
        <div>
          <Select
            label="Schedule for"
            value={mode === "request" ? `req:${requestId}` : mode}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("req:")) {
                setMode("request");
                setRequestId(v.slice(4));
              } else {
                setMode(v as "weeks" | "range");
              }
            }}
          >
            <option value="weeks">Weeks ahead</option>
            <option value="range">Date range</option>
            {requests.length > 0 && (
              <optgroup label="Availability request">
                {requests.map((r) => (
                  <option key={r.id} value={`req:${r.id}`}>
                    {r.name
                      ? `${r.name} (${shortRangeLabel(r.startDate, r.endDate)})`
                      : shortRangeLabel(r.startDate, r.endDate)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>

          <div className="mt-3">
            {mode === "request" ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {request
                  ? `Scheduling ${shortRangeLabel(request.startDate, request.endDate)}.`
                  : "Pick an availability request above."}
              </p>
            ) : mode === "weeks" ? (
              <Stepper
                label="Weeks ahead"
                value={weeks}
                min={1}
                max={26}
                onChange={setWeeks}
              />
            ) : (
              <div className="flex flex-wrap gap-3">
                <div className="w-40">
                  <DateSelect
                    label="Start date"
                    value={start}
                    max={end || undefined}
                    onChange={(v) => {
                      setStart(v);
                      if (end && end < v) setEnd("");
                    }}
                    required
                  />
                </div>
                <div className="w-40">
                  <DateSelect
                    label="End date"
                    value={end}
                    min={start || undefined}
                    onChange={setEnd}
                    required
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Which recurring sets ──────────────────────────────────── */}
        <SetTypePicker
          legend="Recurring sets to schedule"
          info="Each set's color tints its cards in the preview, so you can tell at a glance which recurring set a generated card came from."
          options={templates.map((t) => ({
            id: t.id,
            label: t.label,
            meta: `${DAY_ABBRS[t.dayOfWeek]} ${minutesToShortTimeLabel(
              t.startMinute
            )}`,
            badge: t.team?.name,
          }))}
          picked={picked}
          onPickedChange={choosePicked}
          colors={colors}
          onColorsChange={setColors}
          emptyText="No weekly recurring sets yet — add one first and there’ll be something to expand."
        />

        {error && (
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
