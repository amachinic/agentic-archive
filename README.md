# Image Archivist

A personal image reference library that can actually find things. Point it at a
folder of screenshots, scans, posters, book pages and film stills, and it builds
a searchable, connected archive: every image gets a title, a description, a
controlled set of keyterms and — where the evidence supports it — a creator.

Local-first. The images never leave the machine, the fingerprints and search are
computed locally, and a model is spent only where language or vision genuinely
helps.



## What it does

**A field, not a grid.** The Network view lays the archive on an infinite plane
with similarity wires drawn between related images. Cards spawn as you pan and
despawn behind you, so a thousand images stay fluid. Ask the agent to sort and
the field re-forms into a real grid you read top to bottom: a hue wheel, or dark
to bright.

**One agent, three lenses.** A single agent, Atlas, reasons through three
capability namespaces rather than three separate bots:

| | |
|---|---|
| **Archivist** | names what a thing is: keyterms, meta tags, duplicates, history |
| **Curator** | decides what belongs together: find, filter, sort, sequence, collect |
| **Media Manager** | puts things where they live: folders in-app, real files on disk |

Four doors reach the same actions — conversation, CTA buttons, `/` commands, and
contextual triggers on folder rows — so the surfaces can never drift apart.

**Nothing is written without you.** Agents stage proposals. Exactly one door
commits them: your accept. Tool calls render in the thread as they happen.

## The part that makes search work

Free-text tagging produces captions, not categories — "pocket square", "white
hair", "slightly unsettling", each true of exactly one image and useless as a
filter. So keyterms come from a controlled vocabulary in
[`lib/taxonomy.ts`](lib/taxonomy.ts), enforced at the write door: a term that is
not a category is dropped, and its detail lives in the description, which search
reads.

Two rules keep it honest:

1. **One name, one kind.** The tags table keys on name alone. Before this rule
   existed, the fingerprint pass wrote `portrait` as an *aspect ratio* while the
   vision model wrote it as a *subject*, and whichever ran last flipped the
   shared row — 718 merely tall or wide images ended up filed as portraiture.
   Aspect terms are now `tall` / `wide` / `square` / `panoramic`.
2. **Taggers pick, they do not invent.** Every keyterm is copied verbatim from
   the vocabulary. Across 925 images tagged by six independent agents, all 116
   terms stayed canonical — zero drift.

Artist names get the same treatment, since `weingart` and `wolfgang weingart`
are otherwise two different people.

## Tagging the backlog

Two paths, both resumable:

```bash
npm run tag-local            # free: palette, luma, aspect, Windows OCR
npm run tag-backlog          # Groq vision, paced to the free-tier quota
npx tsx scripts/handtag.ts pull 12 --worker a    # a model with eyes tags them
npx tsx scripts/handtag.ts push batch.json
```

`handtag` stages small JPEGs and takes back a JSON array, folding it in through
the same taxonomy gate. Parallel workers claim disjoint images, so several can
run at once. [`.claude/agents/archivist.md`](.claude/agents/archivist.md) is the
agent training that drives it: the vocabulary, the shape of a good record, and
the attribution rule that matters most — *when unsure, omit; a wrong artist
poisons every future search for them.*

Housekeeping when a vocabulary drifts:

```bash
npm run refine-tags                      # dry run; --apply to commit
npx tsx scripts/handtag.ts merge-artists # fold accent + partial-name duplicates
npx tsx scripts/reocr.ts --apply         # re-read text mangled by an encoding bug
```

## Running it

```bash
npm install
cp .env.example .env.local     # add a Groq key for the agent + vision passes
npm run dev                    # http://localhost:4400
npm run ingest -- "C:/path/to/folder" "Collection Name"
```

Ingest copies files into `library/` — originals are never touched — and computes
a perceptual hash, colour palette, histogram and luma/chroma for each, then
caches similarity pairs.

Node 22+ (uses `node:sqlite`). OCR uses the built-in Windows engine and is
skipped elsewhere.

## Stack

Next.js 16 (App Router) · `node:sqlite` · sharp · canvas rendering · Groq
(`openai/gpt-oss-120b` for language, a vision model for images).

Type: `npx tsc --noEmit`.

## Not in this repo

The `library/` images and `atlas.db` stay local: the archive is full of other
people's work, held as personal reference. Clone this and you get the machine,
not the collection.
