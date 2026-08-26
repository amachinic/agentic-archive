"use client";

import { useEffect, useState } from "react";
import { IconSun, IconMoon } from "./icons";

/*
  Light / dark for the whole dashboard. The boot script in layout.tsx sets
  data-theme before first paint; this control flips it and remembers. The flip
  rides a View Transition where available, so the recolour is one smooth
  cross-fade (the same move the portfolio makes) instead of a hard swap.
*/
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") setTheme(t);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.setAttribute("data-theme", next);
      setTheme(next);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (doc.startViewTransition) doc.startViewTransition(apply);
    else apply();
    try { localStorage.setItem("atlas-theme", next); } catch { /* blocked storage */ }
  }

  return (
    <button
      className={"theme-switch" + (theme === "dark" ? " is-dark" : "")}
      role="switch"
      aria-checked={theme === "dark"}
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-switch__thumb">
        {theme === "dark" ? <IconMoon width={10} height={12} /> : <IconSun width={13} height={13} />}
      </span>
    </button>
  );
}
