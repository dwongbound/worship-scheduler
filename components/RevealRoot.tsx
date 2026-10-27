// Arms the scroll/arrival motion for ONE page: the rules, plus the pre-paint
// script that switches them on.
//
// Both halves are per-page rather than in app/layout.tsx on purpose. The CSS
// needs `html` and `:target` (the attribute goes on the root; smooth scrolling
// belongs to the scrolling element), which a page can't reach through a class,
// and nothing else in the app animates on scroll — so the whole app shouldn't
// carry it. React drops them again on the way out.
//
// Order matters: the script sets the attribute BEFORE the first paint, because
// anything later paints the un-hidden page and then hides it, which is a flash
// of everything disappearing. With no script — a crawler, Google's OAuth
// review, a blocked bundle — or with "reduce motion" set, the attribute is
// never written and every `.reveal` renders exactly as the markup has it. See
// lib/reveal.ts for why that way round is the whole design.
import { REVEAL_CSS, REVEAL_SCRIPT } from "@/lib/reveal";

export default function RevealRoot() {
  return (
    <>
      <style>{REVEAL_CSS}</style>
      <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
    </>
  );
}
