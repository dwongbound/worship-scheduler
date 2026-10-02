// The guided tour behind the review modal's Help button.
//
// The steps live here, away from React, for two reasons: the copy is the part
// most likely to be argued over and it shouldn't require reading JSX to edit,
// and the tour differs between the two modes the same modal serves — the
// generate flow (a proposal that may never be applied) and the calendar's
// Preview Mode (real sets, edited in place). Keeping that fork in one pure
// function is what lets it be tested.
//
// This tour is now the ONLY explanation of the screen: the modal used to carry
// a paragraph of instructions at the top and a shortcut hint under it, and both
// were deleted in favour of asking for help when you want it.

/** Which little illustration the tour modal draws beside a step. */
export type TourArt =
  | "overview"
  | "views"
  | "load"
  | "filter"
  | "hover"
  | "lock"
  | "card"
  | "clipboard"
  | "warnings"
  | "commit";

export type TourStep = {
  /** Stable across both modes, so a step can be pointed at from a test. */
  id: string;
  title: string;
  /** Paragraphs, in order. Plain strings — the modal only lays them out. */
  body: string[];
  art: TourArt;
};

/**
 * The tour, in order. `preview` picks the calendar's Preview Mode wording:
 * there is no draft to save there and the commit button is "Save Changes",
 * so the last step is a different step rather than the same one reworded.
 */
export function tourSteps({ preview }: { preview: boolean }): TourStep[] {
  return [
    {
      id: "overview",
      art: "overview",
      title: "Nothing is saved yet",
      body: [
        preview
          ? "Every card here mirrors a set that is already on the calendar, but the edits you make stay in your browser until you save them."
          : "Every card here is a set this run is proposing. None of it exists yet, and nobody has been told about any of it.",
        "So move people around freely — you can throw the whole thing away and the calendar will not have changed.",
      ],
    },
    {
      id: "views",
      art: "views",
      title: "Three ways to read the plan",
      body: [
        "By set type groups every Thursday Rehearsal together, then every Sunday Morning — the view for comparing the same service week over week.",
        "Chronological (week) lays the plan out in date order with a heading per week, so everything happening in one week sits side by side and the next week follows below.",
        "Chronological (linear) is the same date order with the week breaks taken out: one long row holding every set, for sweeping across a whole season in one go.",
      ],
    },
    {
      id: "load",
      art: "load",
      title: "Who is carrying how much",
      body: [
        "In Team load, each bar is one person and the number is how many slots they hold. Bars are scaled against the busiest person on the list, and the heaviest few turn amber.",
        "The picker above the list changes what is being counted: this plan on its own, everything already booked ahead, or the past month, three, six or twelve. Only this plan is worked out here — the other windows are fetched when you choose them, so the plan never has to carry a year of history around.",
      ],
    },
    {
      id: "filter",
      art: "filter",
      title: "See only certain people's sets",
      body: [
        "Click a name in Team load and the cards below narrow to the sets that person is on. The row you picked turns blue, and a banner over the cards says whose plan you are looking at and how many sets are hidden.",
        "Click more names to add them. You get every set at least one of them is on — two people read as one combined calendar, not only the sets they share.",
        "Grouping still works the way you left it, so you can read a season by set type or in date order. Click a name again to drop that person, or Clear filter to bring the whole plan back.",
      ],
    },
    {
      id: "hover",
      art: "hover",
      title: "Follow one person through the plan",
      body: [
        "Hover a name — in the load list or in any card — and every slot that person holds lights up across the whole plan at once.",
        "It needs a pointer and a screen wide enough to show several sets, so there is nothing to hover on a phone.",
      ],
    },
    {
      id: "lock",
      art: "lock",
      title: "Locking keeps your picks",
      body: [
        "Anyone you choose by hand is locked. Re-run auto schedule and they stay exactly where you put them — only empty and auto-filled slots get reshuffled.",
        "To release one, set its slot back to “None” or click the padlock.",
      ],
    },
    {
      id: "card",
      art: "card",
      title: "Working on one set",
      body: [
        "A card's ↻ fills only that set's empty slots and leaves every other set alone.",
        "The ✕ beside a slot removes that seat from that set. Empty a role of all its seats and it disappears from the card — the “+ role” chips at the bottom bring it back.",
      ],
    },
    {
      id: "clipboard",
      art: "clipboard",
      title: "Copy one set onto another",
      body: [
        "Click a card's own space to select it; its border turns blue. ⌘/Ctrl+C copies both its roles and the people in them.",
        "Select another card and ⌘/Ctrl+V stamps that onto it. The target keeps its own date, name and team and takes everything else, and every pasted seat arrives locked.",
        "⌘/Ctrl+Z takes the last paste back. Change something else in between and the undo is dropped rather than quietly discarding that newer work.",
      ],
    },
    {
      id: "warnings",
      art: "warnings",
      title: "What the warnings mean",
      body: [
        "A red “no one available” role has a seat nobody can fill — either nobody plays it, or everyone who does is busy at that time.",
        "An amber “unavailable” mark is someone placed on a set they are not free for. It never blocks you; it is flagged so that it stays a deliberate choice.",
      ],
    },
    preview
      ? {
          id: "commit",
          art: "commit",
          title: "Saving your changes",
          body: [
            "Save Changes is the only thing that writes to the calendar, and the only thing that messages anyone.",
            "Cancel backs out. If you have made changes it asks first, and lists what it is about to throw away.",
          ],
        }
      : {
          id: "commit",
          art: "commit",
          title: "Drafts, and applying",
          body: [
            "Save Draft parks the whole plan to come back to later; an org can keep five at a time.",
            "The preview also autosaves itself once a minute into a separate recovery slot, which never uses one of those five — the safety net has to keep working when they are all full.",
            "Apply schedule is the step that creates the sets and announces them. Discard throws the preview away.",
          ],
        },
  ];
}
