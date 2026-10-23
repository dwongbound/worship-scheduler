import { ImageResponse } from "next/og";
import { BRAND_MARK_BG, brandMarkDataUri } from "@/lib/brandMark";

// iOS home-screen icon, from the same single mark as the favicon.
//
// The one derivative that is NOT transparent. Apple composites transparency
// onto black and rounds the corners itself, so the mark is laid on the disc's
// own colour — otherwise the white "tw" survives and the disc around it
// vanishes into the fill. 180px is the size iOS asks for.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const src = await brandMarkDataUri();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BRAND_MARK_BG,
        }}
      >
        <img
          src={src}
          width={size.width}
          height={size.height}
          alt=""
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    ),
    size
  );
}
