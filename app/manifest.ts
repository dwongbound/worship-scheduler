import type { MetadataRoute } from "next";

// Web app manifest — lets phones install the site as a home-screen app
// (iOS "Add to Home Screen", Android "Install app"). Next.js serves this
// at /manifest.webmanifest and links it from every page automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TapWorship",
    // Label under the home-screen icon (keep it short or iOS truncates it).
    short_name: "TapWorship",
    description: "Schedule worship teams, cover sets, and manage availability.",
    start_url: "/",
    // Open without browser chrome, like a native app.
    display: "standalone",
    // Splash/background while the app loads (matches bg-gray-50).
    background_color: "#F9FAFB",
    theme_color: "#F9FAFB",
    icons: [
      // Android/Chrome read icons from here; iOS uses the apple-touch-icon
      // link Next emits for app/apple-icon.tsx. Both are GENERATED routes
      // (no extension), not files in public/.
      //
      // "maskable" tells Android it may crop this to whatever shape the
      // launcher uses. The mark is a centred disc on transparency, so there's
      // nothing in the corners to lose — without the hint Android shrinks the
      // icon inside a white badge instead of using it edge to edge.
      { src: "/icon", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon", type: "image/png", sizes: "512x512", purpose: "maskable" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
