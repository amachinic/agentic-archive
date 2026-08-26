# Image Archivist

A multi-agentic dashboard for turning loose image folders into an art-direction-ready visual archive.

Image Archivist helps designers, art directors, photographers, and visual researchers find, compare, sort, collect, and archive reference imagery. **Atlas**, its orchestrating agent, works through three specialized archetypes while the Network, Gallery, Analyze studio, and collection tools remain directly usable by hand.

> Image Archivist is the workspace. Atlas is the agent inside it.

[Open the read-only showcase](https://image-archivist.vercel.app)

![Image Archivist Network dashboard](docs/network-showcase.png)

## What it is for

- **Art direction:** assemble focused visual sets, compare references, and sort a field by color or light.
- **Image sorting:** search titles, descriptions, OCR, creators, prompts, and controlled keyterms.
- **Visual research:** explore similarity connections and move from one reference to related work.
- **Archiving:** deduplicate managed copies, organize nested collections, and export selected sets as real files.
- **Image analysis:** generate structured briefs covering material, lighting, technique, composition, color, context, critique, and differentiation.

## One agent, three archetypes

Atlas is one continuous agent with three capability lenses. They share the same vocabulary, palettes, fingerprints, working set, and visible activity history.

```mermaid
flowchart LR
    Human[Human direction] --> Atlas[Atlas orchestrator]
    Atlas --> Archivist[Archivist<br/>names and describes]
    Atlas --> Curator[Curator<br/>finds and arranges]
    Atlas --> Manager[Media Manager<br/>files and exports]
    Archivist --> Data[(Shared vocabulary,<br/>palettes and fingerprints)]
    Curator --> Data
    Manager --> Data
    Data --> Proposal[Visible proposal]
    Proposal -->|accept| Library[(Image archive)]
    Proposal -->|reject| Stop[No write]
```

| Archetype | Role | Capabilities | Autonomy |
|---|---|---|---|
| **Archivist** | Names what an image is | controlled keyterms, searchable descriptions, creator attribution, duplicate checks, history | Proposes |
| **Curator** | Decides what belongs together | find, filter, expand similar, sort the canvas, build working sets and collections | Acts on the canvas |
| **Media Manager** | Puts images where they live | create or append collections, keep sets in Atlas, export copies to disk | Proposes |

The Curator may change what is visible without changing the archive. Folder and library changes are committed only after human acceptance.

![Atlas agent settings with the Archivist, Curator, Media Manager, and operating guidelines](docs/agents-showcase.png)

## Product surfaces

### Network

An explorable field of image cards connected by visual similarity and shared metadata. Search naturally, filter with controlled keyterms, expand into related images, or ask Atlas to reform the field around an idea.

The Curator can arrange the visible set as a row-major grid:

- **By color:** a hue sweep with dark-to-bright ordering inside each band
- **By light:** darkest at the top, brightest at the bottom
- **Release:** return every image to its network position

### Gallery

A continuously moving visual wall for broad scanning. Hover to pause, scroll or drag to scrub, and open any image directly in Analyze.

### Analyze

Upload an image or choose one from the archive to produce a structured art-direction brief:

- material and lighting
- aesthetic lineage and technique
- time period and historical context
- composition and color reading
- honest critique and differentiation
- controlled subjects, styles, moods, and medium

Continue with image-aware conversation, or stage two images as a diptych for structural, color, and qualitative comparison.

### Collections and archive tools

- Nested virtual folders
- Searchable notes, OCR, titles, descriptions, prompts, and creators
- Ratings, keep/reject flags, and manual tags
- Perceptual-hash and palette-based similarity
- Content-hash duplicate detection
- Copy-only export to a chosen folder
- Source originals left untouched

## Agent operating guidelines

Atlas follows six visible rules in the dashboard:

1. **One brain, three lenses.** Archetypes are capability namespaces, not competing personalities.
2. **Hand-off is shared data.** Every archetype works from the same vocabulary, palettes, fingerprints, and current field.
3. **Autonomy is explicit.** `ACTS` may change the canvas; `PROPOSES` may only stage a library change.
4. **Agent writes have one door.** A staged folder proposal becomes persistent only after acceptance.
5. **Local tools first.** Fingerprints, palettes, OCR, similarity, sorting, and collection operations run locally.
6. **Everything is visible.** Conversation, CTAs, `/` commands, and contextual triggers route to the same actions, with tool activity rendered in the thread.

## The Archivist agent

The repository includes the working [Archivist agent specification](.claude/agents/archivist.md) used to catalogue an image backlog. Its core discipline is simple:

- inspect every image rather than trusting filenames or OCR alone
- write concise, searchable descriptions of what is actually visible
- select keyterms from the controlled vocabulary instead of inventing captions
- attribute a creator only when the evidence is strong
- omit uncertain attribution because a wrong artist damages every future search

The canonical taxonomy lives in [`lib/taxonomy.ts`](lib/taxonomy.ts).

## Local-first architecture

Image Archivist is local-first, not offline-only.

Managed image copies, SQLite metadata, perceptual hashes, palettes, OCR, and similarity data stay on the host machine. Atlas text requests use the configured Groq model. Invoking visual analysis sends a downscaled version of the selected image to the configured Groq vision endpoint. Source originals are read during ingest and are never modified.

```text
source folder
    | copy only
    v
managed library + SQLite
    | local fingerprints, palette, OCR, similarity
    v
Network / Gallery / Analyze / Collections
    | only when requested
    v
Groq language or vision model
```

## Public showcase

The Vercel deployment is deliberately read-only. It uses 12 synthetic, project-owned demo references and static metadata so the product surfaces can be explored without publishing the private image library or enabling public model spend, uploads, exports, or archive mutations.

The demo references were generated specifically for this repository with OpenAI image generation, then split into individual WebP assets. They do not reuse files from the private archive or the user's Downloads folder.

The full persistent product runs locally because its SQLite database, managed images, Windows OCR, and disk export workflow depend on durable host storage.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add `GROQ_API_KEY` to `.env.local` for Atlas and vision analysis.

Ingest a folder:

```bash
npm run ingest -- "C:/path/to/images" "Collection Name"
```

Useful archive passes:

```bash
npm run tag-local
npm run tag-backlog
npm run refine-tags
```

Requires Node.js 22 or newer because the catalog uses `node:sqlite`. Windows OCR is used when available and skipped on other platforms.

To run the hosted showcase behavior locally:

```bash
ATLAS_DEMO=1 npm run dev
```

In PowerShell:

```powershell
$env:ATLAS_DEMO = "1"
npm run dev
```

## Stack

Next.js 16, React 19, TypeScript, `node:sqlite`, Sharp, canvas rendering, and Groq.

```bash
npx tsc --noEmit
npm run build
```

## Repository boundary

The private image library and `atlas.db` are intentionally excluded from Git and Vercel. The repository contains the application, agent behavior, taxonomy, archive tooling, and synthetic showcase assets, not the personal collection.
