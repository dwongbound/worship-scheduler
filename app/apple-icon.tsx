import { ImageResponse } from "next/og";

// iOS home-screen icon. Apple ignores SVG for apple-touch-icon, so this
// renders the app/icon.svg monogram to a PNG at build time — same rects,
// same colors — keeping the "no committed raster assets" convention.
// Next.js emits the <link rel="apple-touch-icon"> tag automatically.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// [x, y, width, height, fill] copied verbatim from app/icon.svg.
// Keep the two files in sync if the mark ever changes.
const RECTS: [number, number, number, number, string][] = [
  // Full-height vertical bars
  [116, 30, 56, 456, "#E0913C"], // orange
  [340, 30, 56, 456, "#3E8A9E"], // teal
  // Yellow horizontal (two segments, gap for the center cross)
  [66, 236, 156, 54, "#E8D06A"],
  [290, 236, 156, 54, "#E8D06A"],
  // Green horizontal (two segments)
  [40, 350, 182, 54, "#2E6E5E"],
  [290, 350, 182, 54, "#2E6E5E"],
  // Woven overlaps: vertical bar x horizontal bar
  [116, 236, 56, 54, "#C86A2E"], // orange x yellow
  [340, 236, 56, 54, "#2E5A3A"], // teal x yellow
  [116, 350, 56, 54, "#1F4A34"], // orange x green
  [340, 350, 56, 54, "#1C5555"], // teal x green
  // Crimson cross, drawn last so it sits on top
  [98, 122, 316, 54, "#C13454"], // arm
  [228, 30, 56, 456, "#C13454"], // upright
  [228, 122, 56, 54, "#8E2438"], // crossing
];

// Home-screen icons are full-bleed squares (iOS rounds the corners itself),
// so give the mark an opaque background and a little breathing room —
// transparent areas would render as black on iOS.
const SCALE = 0.78;
const OFFSET = (512 * (1 - SCALE)) / 2;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#FAF7F0",
        }}
      >
        {RECTS.map(([x, y, w, h, fill], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x * SCALE + OFFSET,
              top: y * SCALE + OFFSET,
              width: w * SCALE,
              height: h * SCALE,
              background: fill,
            }}
          />
        ))}
      </div>
    ),
    size
  );
}
