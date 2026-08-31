# Design references

Frozen studies worth returning to. Each file here is **self-contained** —
typefaces embedded, no server, no network, no repository. Double-click one
and it plays.

These are snapshots, not living code. The working copies stay in
`public/sandboxes/` and are free to drift; these are kept as they were the day
the decision was made, so the reasoning behind a shipped design can be
re-entered later.

The two folders differ on purpose: `public/sandboxes/` is git-ignored, local,
and disposable — everything that is still an open question. This folder is
committed, because a decision that cannot be re-read is a decision that gets
made again.

| File | What it holds |
| --- | --- |
| [agent-presence.html](agent-presence.html) | How to show which agent is at work inside a prompt panel. Nine treatments (row badges → presence chip → hand-off rail → leading idents → Atlas-and-subagents → full deck → chip+idents → nested → nested with tasks), four scripted use cases, and a motion switch — live, settle-when-done, check-when-done. Treatment **I** is what shipped. |

## Reading agent-presence.html

The toolbar is the whole instrument: pick a **treatment**, a **use case**,
and a **motion** mode, and the panel replays a real agent turn through that
combination. The interesting comparisons are the ones that isolate a single
variable — the same turn in `live` versus `check` motion, or the same
treatment against the four-line `sort canvas` case and the long
`outside hunt`, which is where a design that looks calm at rest starts to
feel busy.

The idents are the house 5×5 dither language, one verb per lens: the
Historian's ring departing from centre, the Curator's checkerboard resolving
into a plus, the Archivist's scan line sweeping down, the Media Manager's
payload dropping into a tray. Completion dissolves whichever was moving into
the pixelated check.
