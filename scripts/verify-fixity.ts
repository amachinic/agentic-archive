/*
  Fixity: prove the files are still the files.

  Every image was checksummed once, at ingest, and the hash then sat unread
  -- which protects nothing. This walks the library, recomputes SHA-256 for
  every managed file, and compares. Three outcomes, all recorded as events:

    fixity-verify   the periodic run itself, with its totals
    fixity-drift    a file whose bytes no longer match their hash
    fixity-missing  a file the database expects that is not on disk

  Drift is never "repaired" automatically: a changed file is evidence, and
  the Registrar's job is to say so loudly, not to quietly re-hash it.

    npx tsx scripts/verify-fixity.ts            # verify everything
    npx tsx scripts/verify-fixity.ts --limit 50 # spot check
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { db, LIBRARY_DIR } from "../lib/db";
import { recordEvent } from "../lib/events";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };
const LIMIT = Number(flag("limit", "0"));

const conn = db();
const rows = conn.prepare("SELECT id, rel_path, sha256, bytes FROM images ORDER BY id").all() as
  { id: number; rel_path: string; sha256: string | null; bytes: number }[];
const todo = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;

let ok = 0, drift = 0, missing = 0, unhashed = 0;
const t0 = Date.now();

for (const r of todo) {
  const abs = path.join(LIBRARY_DIR, r.rel_path);
  if (!fs.existsSync(abs)) {
    missing++;
    console.log("  MISSING  #" + r.id + "  " + r.rel_path);
    recordEvent("registrar", "fixity-missing", { rel_path: r.rel_path }, r.id);
    continue;
  }
  if (!r.sha256) { unhashed++; continue; }
  const h = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  if (h === r.sha256) { ok++; continue; }
  drift++;
  console.log("  DRIFT    #" + r.id + "  " + r.rel_path);
  console.log("           expected " + r.sha256.slice(0, 16) + "…  got " + h.slice(0, 16) + "…");
  recordEvent("registrar", "fixity-drift", { rel_path: r.rel_path, expected: r.sha256, actual: h }, r.id);
}

const secs = Math.round((Date.now() - t0) / 1000);
recordEvent("registrar", "fixity-verify", { checked: todo.length, ok, drift, missing, unhashed, seconds: secs });
console.log(
  "\nfixity: " + ok + "/" + todo.length + " verified in " + secs + "s" +
  (drift ? " · " + drift + " DRIFTED" : "") +
  (missing ? " · " + missing + " MISSING" : "") +
  (unhashed ? " · " + unhashed + " never hashed" : "") +
  (!drift && !missing ? " · the archive is intact" : "")
);
process.exit(drift || missing ? 1 : 0);
