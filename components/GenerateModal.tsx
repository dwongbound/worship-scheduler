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
import { useEffect, useState } from "react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import Checkbox from "./common/Checkbox";
import ColorPicker from "./common/ColorPicker";
import DateSelect from "./common/DateSelect";
import InfoTooltip from "./common/InfoTooltip";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import Select from "./common/Select";
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
export type TemplateColors = Record<string, string>;

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
  useEffect(() => {
    if (open) setPicked(templates.map((t) => t.id));
  }, [open, templates]);
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
        <fieldset className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between gap-3">
            <legend className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Recurring sets to schedule
              <InfoTooltip text="Each set's color tints its cards in the preview, so you can tell at a glance which recurring set a generated card came from." />
            </legend>
            {templates.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setPicked(allPicked ? [] : templates.map((t) => t.id))
                }
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {allPicked ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No weekly recurring sets yet — add one first and there&rsquo;ll be
              something to expand.
            </p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {templates.map((t) => {
                const checked = picked.includes(t.id);
                return (
                  <li key={t.id} className="flex items-center gap-2">
                    {/* min-w-0 so a long set name truncates rather than
                        shoving the colour swatch off the row. fitLabel keeps
                        the hit area on the box and its text — the blank stretch
                        between the name and the colour swatch used to toggle
                        the row, which is invisible and easy to hit by accident. */}
                    <span className="min-w-0 flex-1">
                      <Checkbox
                        fitLabel
                        label={
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{t.label}</span>
                            <span className="shrink-0 text-gray-500 dark:text-gray-400">
                              {DAY_ABBRS[t.dayOfWeek]}{" "}
                              {minutesToShortTimeLabel(t.startMinute)}
                            </span>
                            {t.team && (
                              <Badge tone="indigo">{t.team.name}</Badge>
                            )}
                          </span>
                        }
                        checked={checked}
                        onChange={() =>
                          setPicked((prev) =>
                            prev.includes(t.id)
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id]
                          )
                        }
                      />
                    </span>
                    {/* The colour only means something for a set that's being
                        scheduled, so the swatch appears with the tick. */}
                    {checked && (
                      <span className="shrink-0">
                        <ColorPicker
                          value={colors[t.id] ?? null}
                          label={`Preview color for ${t.label}`}
                          onChange={(hex) =>
                            setColors((prev) => {
                              const next = { ...prev };
                              if (hex) next[t.id] = hex;
                              else delete next[t.id];
                              return next;
                            })
                          }
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {error && (
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
