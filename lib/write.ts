/*
  Every write in the shell, and what to say when the server refuses one.

  The hosted archive answers writes with a sentence written for a person, not
  a code. Passing that sentence through is the whole point: a visitor who
  clicks New folder on the read-only archive should be told the archive is
  read-only, not left watching nothing happen, and not shown "something went
  wrong", which reads like the site is broken when it is behaving exactly as
  designed. Locally the same path carries the real reason a write failed.
*/

export type WriteResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string; status: number };

/** Capitalised for a dialog body: server messages are written lowercase. */
function asSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1);
}

export async function write<T = unknown>(url: string, init?: RequestInit): Promise<WriteResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, message: "The archive did not answer. Check that the server is still running.", };
  }

  let body: unknown = null;
  try { body = await res.json(); } catch { /* an empty or non-JSON body is fine */ }

  if (res.ok) return { ok: true, data: body as T };

  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : "";
  return {
    ok: false,
    status: res.status,
    message: said ? asSentence(said) : "That did not go through (" + res.status + ").",
  };
}
