"use client";
// A small red dot marking the exact thing that needs attention: the role with
// an empty seat, the section holding an unanswered request, the profile panel
// that's keeping you off the schedule. Same red as the calendar's StatusDot,
// so a red dot means the same thing everywhere in the app.
//
// It always carries words. A colour alone can't say WHAT is wrong, and reaches
// a screen reader not at all — so `label` is required, not optional.
export default function AttentionDot({
  label,
  // Size and spacing belong to the caller: a dot beside a section heading
  // wants more of both than one tucked after a role name.
  className = "h-1.5 w-1.5",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block shrink-0 rounded-full bg-red-500 align-middle ${className}`}
    />
  );
}
