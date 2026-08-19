"use client";
// Boolean slider — the on/off counterpart to Checkbox, for state that reads as
// a mode ("this person is active on this team") rather than one tick in a list.
// The whole control is one button so the label is part of the hit area.

export default function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Always required: it's the accessible name even when visually hidden.
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* Track: indigo when on, gray when off. */}
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked
            ? "bg-indigo-600 dark:bg-indigo-500"
            : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        {/* Knob: slides the width of the track minus its own inset. */}
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      {!hideLabel && <span>{label}</span>}
    </button>
  );
}
