import type { Config } from "tailwindcss";

const config: Config = {
  // "class" strategy: dark mode is toggled by adding/removing the `dark`
  // class on <html>. See the theme script in app/layout.tsx and the
  // toggle button in components/Navbar.tsx.
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand accent. The app is written entirely in `indigo-*` utility
        // classes; we remap that whole palette to the favicon's teal
        // (#3E8A9E at 600) so every button, link, and highlight picks up the
        // brand color without touching individual class names.
        indigo: {
          50: "#f1f8f9",
          100: "#dcedf1",
          200: "#bcdce2",
          300: "#8fc4cf",
          400: "#5aa5b5",
          500: "#45909f",
          600: "#3e8a9e", // favicon teal — primary buttons, today pill, links
          700: "#346e7d", // hover
          800: "#2f5a66",
          900: "#2b4c56",
          950: "#182f37",
        },
      },
      keyframes: {
        // Three dots that "jump" out of phase (LoadingDots).
        jump: {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.5" },
          "40%": { transform: "translateY(-60%)", opacity: "1" },
        },
        // Equalizer bars — the "worship music" animation on the splash.
        equalize: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        // Soft breathing pulse for the app name on the splash.
        "pulse-name": {
          "0%, 100%": { opacity: "0.6", transform: "scale(0.99)" },
          "50%": { opacity: "1", transform: "scale(1.015)" },
        },
        // Radiating light rings behind the splash mark.
        radiate: {
          "0%": { transform: "scale(0.6)", opacity: "0.6" },
          "100%": { transform: "scale(1.8)", opacity: "0" },
        },
      },
      animation: {
        jump: "jump 1.2s ease-in-out infinite",
        equalize: "equalize 1s ease-in-out infinite",
        "pulse-name": "pulse-name 1.8s ease-in-out infinite",
        radiate: "radiate 2s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
