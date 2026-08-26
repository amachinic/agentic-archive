"use client";

/*
  App-wide dialog system: prompt / confirm / alert as design-system modals,
  replacing the browser's native dialogs. Promise-based, so call sites read
  exactly like the natives:
    const name = await dialogs.prompt({ title: "New folder", label: "Name" });
    if (await dialogs.confirm({ title: "Remove?", danger: true })) ...
*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type PromptOpts = {
  title: string; message?: string; label?: string;
  placeholder?: string; initial?: string; confirmLabel?: string;
};
export type ConfirmOpts = {
  title: string; message?: string; confirmLabel?: string; danger?: boolean;
};
export type AlertOpts = { title: string; message?: string };

type Pending =
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void };

type Api = {
  prompt: (o: PromptOpts) => Promise<string | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  alert: (o: AlertOpts) => Promise<void>;
};

const Ctx = createContext<Api | null>(null);

export function useDialogs(): Api {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialogs must be used inside DialogProvider");
  return c;
}

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const prompt = useCallback((opts: PromptOpts) =>
    new Promise<string | null>((resolve) => { setText(opts.initial ?? ""); setPending({ kind: "prompt", opts, resolve }); }), []);
  const confirm = useCallback((opts: ConfirmOpts) =>
    new Promise<boolean>((resolve) => setPending({ kind: "confirm", opts, resolve })), []);
  const alert = useCallback((opts: AlertOpts) =>
    new Promise<void>((resolve) => setPending({ kind: "alert", opts, resolve })), []);

  const dismiss = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "prompt") pending.resolve(null);
    else if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve();
    setPending(null);
  }, [pending]);

  const submit = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "prompt") pending.resolve(text.trim() || null);
    else if (pending.kind === "confirm") pending.resolve(true);
    else pending.resolve();
    setPending(null);
  }, [pending, text]);

  // Focus lands on the input (prompt) or the primary action; Escape dismisses.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      if (pending.kind === "prompt") inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); }
      if (e.key === "Enter" && pending.kind !== "prompt") { e.preventDefault(); submit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [pending, dismiss, submit]);

  const o = pending?.opts;

  return (
    <Ctx.Provider value={{ prompt, confirm, alert }}>
      {children}
      {pending && o && (
        <div className="dlg-veil" onMouseDown={dismiss}>
          <div
            className="dlg"
            role={pending.kind === "alert" ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-label={o.title}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="dlg__title">{o.title}</h3>
            {o.message && <p className="dlg__message">{o.message}</p>}

            {pending.kind === "prompt" && (
              <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="dlg__form">
                {pending.opts.label && <label className="mono-label" htmlFor="dlg-input">{pending.opts.label}</label>}
                <div className="field">
                  <input
                    id="dlg-input"
                    ref={inputRef}
                    value={text}
                    placeholder={pending.opts.placeholder}
                    onChange={(e) => setText(e.target.value)}
                  />
                </div>
              </form>
            )}

            <div className="dlg__foot">
              {pending.kind !== "alert" && (
                <button className="btn is-ghost" onClick={dismiss}>Cancel</button>
              )}
              <button
                ref={confirmRef}
                className={"btn " + (pending.kind === "confirm" && pending.opts.danger ? "is-danger" : "is-primary")}
                onClick={submit}
                disabled={pending.kind === "prompt" && !text.trim()}
              >
                {(pending.kind === "prompt" && pending.opts.confirmLabel) ||
                 (pending.kind === "confirm" && pending.opts.confirmLabel) ||
                 (pending.kind === "alert" ? "OK" : "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
