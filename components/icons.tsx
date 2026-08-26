/* Minimal 1.5px-stroke icon set, sized by the consumer via CSS. */

type P = React.SVGProps<SVGSVGElement>;
const base = (p: P): P => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconGrid = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
);
export const IconNetwork = (p: P) => (
  <svg {...base(p)}><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="5" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M6.8 7.4 10.6 16M17.5 6.6l-4 9.6M7.2 6.3l9.6-1"/></svg>
);
export const IconColumns = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>
);
export const IconFolder = (p: P) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
);
export const IconTag = (p: P) => (
  <svg {...base(p)}><path d="M4 4h7l9 9-7 7-9-9Z"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none"/></svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/></svg>
);
export const IconCaret = (p: P) => (
  <svg {...base(p)}><path d="m9 6 6 6-6 6"/></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14"/></svg>
);
export const IconSparkle = (p: P) => (
  <svg {...base(p)}><path d="M12 3v0c.6 3.9 3.5 6.8 7.4 7.4v0c.8.1.8 1.1 0 1.2v0c-3.9.6-6.8 3.5-7.4 7.4v0c-.1.8-1.1.8-1.2 0v0C10.2 15.1 7.3 12.2 3.4 11.6v0c-.8-.1-.8-1.1 0-1.2v0C7.3 9.8 10.2 6.9 10.8 3v0c.1-.8 1.1-.8 1.2 0Z"/></svg>
);
/* the agent mark: the dither glyph resolved — five cells of the diamond */
export const IconAgent = (p: P) => (
  <svg {...base(p)}>
    <rect x="10" y="3.5" width="4" height="4" rx="1" />
    <rect x="3.5" y="10" width="4" height="4" rx="1" />
    <rect x="10" y="10" width="4" height="4" rx="1" />
    <rect x="16.5" y="10" width="4" height="4" rx="1" />
    <rect x="10" y="16.5" width="4" height="4" rx="1" />
  </svg>
);
export const IconFlag = (p: P) => (
  <svg {...base(p)}><path d="M5 21V4c4-2.4 8 2.4 12 0v10c-4 2.4-8-2.4-12 0"/></svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18"/></svg>
);
export const IconLink = (p: P) => (
  <svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2"/></svg>
);
export const IconWaterfall = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="5" height="9" rx="1"/><rect x="3" y="15" width="5" height="6" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="10" y="11" width="5" height="10" rx="1"/><rect x="17" y="3" width="5" height="12" rx="1"/><rect x="17" y="18" width="5" height="3" rx="1"/></svg>
);
export const IconInfo = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"/></svg>
);
/* The Atlas mark (from ATLAS.svg). Body follows currentColor; the cut-through
   stroke takes the surface token, so it holds in both themes. */
export const AtlasMark = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 172 172" fill="currentColor" aria-hidden {...p}>
    <path d="M48.38,104.3c18.97-19.86,30.51-46.8,32.49-75.87.46-6.75.34-13.84.23-20.71-.03-1.96-.06-3.9-.08-5.82l-.02-1.98H17.06C7.56-.07-.14,7.63-.14,17.13v117.07c18.58-5.7,35.06-15.81,48.52-29.9Z"/>
    <path d="M157.38,137.46c-18.57-15.1-47.48-25.24-71.93-25.24-3.58,0-7.06.21-10.26.63-29.09,2.27-54.39,14.27-75.33,35.7v6.18c0,9.5,7.7,17.21,17.21,17.21h137.59c9.5,0,17.21-7.7,17.21-17.21v-3.77c-4.22-4.56-9.01-9.04-14.48-13.49Z"/>
    <path d="M154.65-.07h-73.66l6.27.08s-.03,4.89-.04,6.37c-.07,9.19-.13,18.7.74,27.44,2.61,27.12,14.68,52.65,33.97,71.88,13.83,13.98,31.16,24.07,49.91,29.42V17.13C171.86,7.63,164.15-.07,154.65-.07Z"/>
    <path fill="var(--surface)" d="M87.97,33.82c-.88-8.75-.81-18.25-.74-27.44.01-1.48.04-6.37.04-6.37l-6.27-.08.02,1.98c.02,1.92.05,3.86.08,5.82.11,6.86.23,13.96-.23,20.71-1.98,29.07-13.51,56.01-32.49,75.87-13.46,14.09-29.94,24.2-48.52,29.9v14.34c20.94-21.43,46.24-33.43,75.33-35.7,3.2-.41,6.68-.63,10.26-.63,24.45,0,53.36,10.15,71.93,25.24,5.47,4.45,10.26,8.93,14.48,13.49v-15.84c-18.75-5.35-36.08-15.44-49.91-29.42-19.29-19.22-31.36-44.75-33.97-71.88Z"/>
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}><path d="m6 9.5 6 6 6-6"/></svg>
);
/* Sun + moon: the custom marks from the Luvsich 2.0 portfolio toggle. */
export const IconSun = (p: P) => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden {...p}>
    <path d="M8.99999 13.3575C11.4066 13.3575 13.3575 11.4066 13.3575 9C13.3575 6.59342 11.4066 4.6425 8.99999 4.6425C6.59341 4.6425 4.64249 6.59342 4.64249 9C4.64249 11.4066 6.59341 13.3575 8.99999 13.3575Z" strokeMiterlimit="10"/>
    <path d="M9 0.802505V3.17251" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 14.8275V17.1975" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M17.1975 9H14.8275" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3.17249 9H0.80249" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3.20999 3.2025L4.87499 4.8825" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M13.125 13.1175L14.7975 14.7975" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14.7975 3.2025L13.125 4.8825" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4.87499 13.1175L3.20999 14.7975" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
export const IconMoon = (p: P) => (
  <svg viewBox="0 0 13 15" fill="none" stroke="currentColor" strokeWidth={1.1} aria-hidden {...p}>
    <path d="M2.53355 6.90775C2.53355 3.84658 4.62955 1.28491 7.41961 0.649847C7.62782 0.599898 7.83603 0.56422 8.05119 0.542813C7.80827 0.514271 7.55841 0.5 7.30162 0.5C3.54685 0.5 0.5 3.63252 0.5 7.5C0.5 11.3675 3.54685 14.5 7.30856 14.5C9.39069 14.5 11.2507 13.5367 12.5 12.024C11.4589 12.8303 10.168 13.3084 8.76605 13.3084C5.3236 13.3084 2.53355 10.4399 2.53355 6.90061V6.90775Z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
);
export const IconUndo = (p: P) => (
  <svg {...base(p)}><path d="M4 10h10a6 6 0 0 1 0 12h-4"/><path d="M8 6l-4 4 4 4"/></svg>
);
export const IconSort = (p: P) => (
  <svg {...base(p)}><path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/></svg>
);
export const IconClock = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>
);
export const IconDrive = (p: P) => (
  <svg {...base(p)}><rect x="2.5" y="9" width="19" height="8" rx="2"/><path d="M6 9l2.6-4.6h6.8L18 9"/><circle cx="17.5" cy="13" r="1" fill="currentColor" stroke="none"/></svg>
);
export const IconPalette = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="8.4" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.6" cy="13.4" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.4" cy="13.4" r="1.5" fill="currentColor" stroke="none"/></svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/></svg>
);
export const IconSave = (p: P) => (
  <svg {...base(p)}><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m4 12.5 5 5L20 6.5"/></svg>
);
export const IconArrowLeft = (p: P) => (
  <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/></svg>
);
