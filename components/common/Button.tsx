"use client";
// Reusable button. Add variants/sizes here as the app grows.
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "admin";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400",
  secondary:
    "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 " +
    "dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400",
  ghost:
    "bg-transparent text-gray-700 hover:bg-gray-100 " +
    "dark:text-gray-300 dark:hover:bg-gray-800",
  // Admin-only action: "secondary" wearing the amber accent the app marks
  // admin surfaces with (the Navbar's admin tabs, "Org settings"). Same
  // outlined shape and ground as the neutral buttons it sits beside, so a
  // toolbar reads as one row and only the colour says "admin".
  admin:
    "bg-white text-amber-600 border border-amber-500 hover:bg-amber-50 " +
    "dark:bg-gray-800 dark:text-amber-400 dark:border-amber-500/70 " +
    "dark:hover:bg-amber-500/10",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-70
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
