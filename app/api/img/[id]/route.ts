import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db, LIBRARY_DIR, THUMB_DIR } from "@/lib/db";
import { makeThumb } from "@/lib/ingest";
import { demoAssetPath } from "@/lib/demo";
import { IS_HOSTED_DEMO, IS_PUBLIC_ARCHIVE } from "@/lib/runtime";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
};

/**
 * GET /api/img/:id        -> cached 720px webp thumb (regenerated if missing)
 * GET /api/img/:id?s=320  -> small cached variant (node cards; 64..512)
 * GET /api/img/:id?full=1 -> the original file from the library
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!/^\d+$/.test(idRaw) || !Number.isSafeInteger(id) || id < 1) {
    return new Response("bad id", { status: 400 });
  }

  if (IS_HOSTED_DEMO) {
    const asset = demoAssetPath(id);
    if (!asset) return new Response("not found", { status: 404 });
    return Response.redirect(new URL(asset, req.url), 307);
  }

  if (IS_PUBLIC_ARCHIVE) {
    const row = db().prepare("SELECT id FROM images WHERE id = ?").get(id);
    if (!row) return new Response("not found", { status: 404 });

    const blobBase = process.env.ATLAS_BLOB_BASE_URL?.trim().replace(/\/+$/, "");
    if (!blobBase) {
      return new Response("archive image storage is not configured", { status: 503 });
    }

    let assetUrl: URL;
    try {
      const baseUrl = new URL(blobBase);
      if (baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
        throw new Error("invalid blob base URL");
      }
      assetUrl = new URL(`${blobBase}/archive/images/${id}.webp`);
      if (assetUrl.protocol !== "https:" && assetUrl.protocol !== "http:") {
        throw new Error("unsupported blob URL protocol");
      }
    } catch {
      return new Response("archive image storage is not configured", { status: 503 });
    }

    return new Response(null, {
      status: 307,
      headers: {
        Location: assetUrl.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const row = db().prepare("SELECT rel_path FROM images WHERE id = ?").get(id) as { rel_path: string } | undefined;
  if (!row) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const small = url.searchParams.get("s") ? Math.max(64, Math.min(512, Number(url.searchParams.get("s")))) : null;
  const libAbs = path.join(LIBRARY_DIR, row.rel_path);

  let filePath: string;
  let type: string;
  if (full) {
    filePath = libAbs;
    type = MIME[path.extname(libAbs).toLowerCase()] ?? "application/octet-stream";
  } else if (small) {
    filePath = path.join(THUMB_DIR, id + "_" + small + ".webp");
    type = "image/webp";
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      try {
        const sharp = (await import("sharp")).default;
        await sharp(libAbs, { failOn: "none" })
          .rotate()
          .resize(small, small, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 76 })
          .toFile(filePath);
      } catch {
        filePath = path.join(THUMB_DIR, id + ".webp");
        if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
          try { await makeThumb(libAbs, id); } catch { filePath = libAbs; type = MIME[path.extname(libAbs).toLowerCase()] ?? "application/octet-stream"; }
        }
      }
    }
  } else {
    filePath = path.join(THUMB_DIR, id + ".webp");
    type = "image/webp";
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      try { await makeThumb(libAbs, id); }
      catch { filePath = libAbs; type = MIME[path.extname(libAbs).toLowerCase()] ?? "application/octet-stream"; }
    }
  }

  try {
    const buf = await fsp.readFile(/*turbopackIgnore: true*/ filePath);
    const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Response(body, {
      headers: {
        "Content-Type": type,
        // Content is immutable per id: edits create new rows, so cache hard.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("file missing", { status: 404 });
  }
}
