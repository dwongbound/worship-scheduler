// E2E: the desktop "back to top" floating button.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("the scroll-to-top button appears after scrolling and returns to the top", async ({
  page,
}) => {
  // Wide viewport so the desktop-only (`sm:flex`) button is present at all.
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, "carol");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  // Guarantee the page is taller than one screen regardless of how much content
  // the seed data renders, so there's room to scroll past the reveal threshold.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.body.appendChild(spacer);
  });

  // The button is always in the DOM but toggles via opacity, so assert the
  // computed opacity rather than toBeVisible (opacity:0 still counts as visible).
  const button = page.getByRole("button", { name: "Scroll to top" });
  await expect(button).toHaveCSS("opacity", "0");

  // Scroll past half a viewport — the button fades in.
  await page.evaluate(() => window.scrollTo(0, window.innerHeight));
  await expect(button).toHaveCSS("opacity", "1");

  // Clicking it smooth-scrolls back to the top, and the button hides again.
  await button.click();
  await expect(button).toHaveCSS("opacity", "0");
  // Back above the 150px (half of the 300px viewport) reveal threshold.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(150);
});
