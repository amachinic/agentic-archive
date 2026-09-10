/*
  The panel's memory.

  A conversation is the thread plus the field it left behind -- the prompt
  ids, the sort, the pinned filters, the light table -- named by the first
  thing asked and ordered by the last thing done. It lives in the browser:
  the hosted copy is shared by everyone who visits and must not remember
  one visitor's chats for the next, and on the local build one browser on
  one machine is the whole audience. Fifty is the cap; the oldest go first.

  Nothing here knows what a thread item is. The panel hands its own item
  type in, and this only stores, orders and trims it.
*/

export type Convo<T> = {
  id: string;
  /** the first thing asked */
  topic: string;
  /** last activity: a message landing, not a re-read */
  at: number;
  createdAt: number;
  thread: T[];
  promptIds: number[] | null;
  fieldSort: string | null;
  filterTags: string[];
  lightTable: unknown | null;
};

const KEY = "atlas-conversations";
const CAP = 50;
/* localStorage holds about 5MB per origin; the thumbnails of an outside search
   are URLs, but a thousand of them add up, so the whole store stays under
   this and the oldest conversations pay when it does not */
const BYTES = 3_500_000;

export function newConvoId(): string {
  try { return crypto.randomUUID(); } catch { /* no crypto: an old browser */ }
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function loadConvos<T>(): Convo<T>[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((c): c is Convo<T> =>
      !!c && typeof c === "object" && typeof c.id === "string" && Array.isArray(c.thread) && typeof c.at === "number",
    );
  } catch {
    return [];
  }
}

export function saveConvos<T>(list: Convo<T>[]): void {
  try {
    const kept = list
      .filter((c) => c.thread.length > 0)
      .sort((a, b) => b.at - a.at)
      .slice(0, CAP);
    let json = JSON.stringify(kept);
    while (json.length > BYTES && kept.length > 1) { kept.pop(); json = JSON.stringify(kept); }
    localStorage.setItem(KEY, json);
  } catch {
    /* blocked storage, a private window, a full quota: the panel still works, it just forgets */
  }
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (ms: number) => { const d = new Date(ms); return Math.floor((d.getTime() - d.getTimezoneOffset() * MIN) / DAY); };

/** "now" · "12 min" · "14:02" · "yesterday" · "tue" · "3 sep" */
export function whenLabel(at: number, now = Date.now()): string {
  const d = new Date(at), age = now - at, days = dayOf(now) - dayOf(at);
  if (age < MIN) return "now";
  if (age < HOUR) return Math.max(1, Math.round(age / MIN)) + " min";
  if (days === 0) return pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (days === 1) return "yesterday";
  if (days < 7) return DAYS[d.getDay()];
  return d.getDate() + " " + MONTHS[d.getMonth()];
}
