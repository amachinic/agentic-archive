"use client";

/*
  Custom select: a design-system trigger + popover menu, replacing the native
  <select> everywhere. Two triggers: "btn" (toolbar control) and "pill"
  (inline chip, e.g. the inspector's add-to-folder). Closes on outside click
  and Escape; basic arrow-key support.
*/

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconCheck } from "./icons";

export type SelectOption = { value: string; label: string; depth?: number };

export default function Select({
  value, options, onChange, ariaLabel, placeholder, variant = "btn", align = "left", width,
}: {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  variant?: "btn" | "pill";
  align?: "left" | "right";
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
      if (e.key === "Enter" && hi >= 0) { e.preventDefault(); onChange(options[hi].value); setOpen(false); }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hi, options, onChange]);

  function toggle() {
    setHi(options.findIndex((o) => o.value === value));
    setOpen((o) => !o);
  }

  return (
    <div className="select" ref={rootRef} style={width ? { width } : undefined}>
      <button
        className={variant === "btn" ? "btn select__trigger" : "tag-pill select__trigger--pill"}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={width ? { width: "100%" } : undefined}
      >
        <span className="select__label">{current?.label ?? placeholder ?? "Select"}</span>
        <IconChevronDown width={12} height={12} className={"select__chev" + (open ? " is-open" : "")} />
      </button>
      {open && (
        <div className={"select__menu" + (align === "right" ? " is-right" : "")} role="listbox" aria-label={ariaLabel}>
          {options.map((o, i) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={
                "select__opt" +
                (o.value === value ? " is-active" : "") +
                (i === hi ? " is-hi" : "")
              }
              style={o.depth ? { paddingLeft: 12 + o.depth * 14 } : undefined}
              onMouseEnter={() => setHi(i)}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="select__opt-label">{o.label}</span>
              {o.value === value && <IconCheck width={12} height={12} style={{ color: "var(--accent)", flex: "none" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
