import { ImageResponse } from "next/og";
import { brandMarkDataUri } from "@/lib/brandMark";

// Favicon, generated from the single committed mark at build time.
// Next serves it at /icon and emits the <link rel="icon"> tag itself.
// Transparent — a browser tab sits on either theme.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
  const src = await brandMarkDataUri();
  return new ImageResponse(
    (
      <img
        src={src}
        width={size.width}
        height={size.height}
        alt=""
        style={{ width: "100%", height: "100%" }}
      />
    ),
    size
  );
}
