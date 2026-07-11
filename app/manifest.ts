import type { MetadataRoute } from "next";

// Web app manifest — lets phones install the site as a home-screen app
// (iOS "Add to Home Screen", Android "Install app"). Next.js serves this
// at /manifest.webmanifest and links it from every page automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Worship Scheduler",
    // Label under the home-screen icon (keep it short or iOS truncates it).
    short_name: "Tap Worship",
    description: "Schedule worship teams, cover sets, and manage availability.",
    start_url: "/",
    // Open without browser chrome, like a native app.
    display: "standalone",
    // Splash/background while the app loads (matches bg-gray-50).
    background_color: "#F9FAFB",
    theme_color: "#F9FAFB",
    icons: [
      // Android/Chrome read icons from here; iOS uses the apple-touch-icon
      // link that app/apple-icon.tsx generates.
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "512x512" },
    ],
  };
}
