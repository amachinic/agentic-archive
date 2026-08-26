import sharp from "sharp";

/* ============================================================
   Local image analysis. Everything here runs on the machine with no
   network call: perceptual hash, colour palette, histogram, luma/chroma.
   This is what makes 942 images searchable and clusterable instantly,
   and it is what catches ComfyUI re-rolls of the same seed.
   ============================================================ */

const DCT_SIZE = 32; // sample grid; the hash uses the top-left 8x8 of its DCT
const HASH_SIDE = 8;

/** Precomputed DCT-II basis. Built once: it is the hot loop in ingest. */
const COS = (() => {
  const t = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let x = 0; x < DCT_SIZE; x++) {
    for (let u = 0; u < DCT_SIZE; u++) {
      t[x * DCT_SIZE + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE));
    }
  }
  return t;
})();

function dct2d(input: Float64Array): Float64Array {
  const rows = new Float64Array(DCT_SIZE * DCT_SIZE);
  // rows
  for (let y = 0; y < DCT_SIZE; y++) {
    for (let u = 0; u < DCT_SIZE; u++) {
      let s = 0;
      for (let x = 0; x < DCT_SIZE; x++) s += input[y * DCT_SIZE + x] * COS[x * DCT_SIZE + u];
      rows[y * DCT_SIZE + u] = s * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  // columns
  const out = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let u = 0; u < DCT_SIZE; u++) {
    for (let v = 0; v < DCT_SIZE; v++) {
      let s = 0;
      for (let y = 0; y < DCT_SIZE; y++) s += rows[y * DCT_SIZE + u] * COS[y * DCT_SIZE + v];
      out[v * DCT_SIZE + u] = s * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return out;
}

/**
 * 64-bit DCT perceptual hash, returned as 16 hex chars.
 * Robust to rescale, re-encode and mild colour grading, which is exactly the
 * difference between two ComfyUI exports of the same generation.
 */
export async function pHash(buf: Buffer): Promise<string> {
  const raw = await sharp(buf)
    .greyscale()
    .resize(DCT_SIZE, DCT_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();

  const px = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let i = 0; i < px.length; i++) px[i] = raw[i];

  const freq = dct2d(px);

  // Top-left 8x8 block = lowest frequencies. Skip the DC term when taking the
  // median: it carries overall brightness and would bias every bit.
  const vals: number[] = [];
  for (let v = 0; v < HASH_SIDE; v++) {
    for (let u = 0; u < HASH_SIDE; u++) vals.push(freq[v * DCT_SIZE + u]);
  }
  const sorted = vals.slice(1).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let n = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (vals[nibble * 4 + bit] > median) n |= 1 << (3 - bit);
    }
    hex += n.toString(16);
  }
  return hex;
}

const POPCOUNT = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
  return t;
})();

/** Hamming distance between two 16-char hex hashes. 0 = identical, 64 = opposite. */
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    d += POPCOUNT[x & 0xff];
  }
  return d;
}

export type Swatch = { hex: string; r: number; g: number; b: number; pct: number };

function toHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/**
 * Palette via k-means in RGB, seeded deterministically (k-means++ style
 * farthest-point seeding, no RNG) so the same image always yields the same
 * swatches in the same order. Sampling a 64x64 thumb keeps it fast.
 */
export async function palette(buf: Buffer, k = 6): Promise<{ swatches: Swatch[]; histogram: number[]; luma: number; chroma: number }> {
  const S = 64;
  const raw = await sharp(buf).resize(S, S, { fit: "cover" }).removeAlpha().raw().toBuffer();
  const n = S * S;

  const pts: number[][] = [];
  for (let i = 0; i < n; i++) pts.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);

  // --- 3x3x3 RGB histogram (27 bins), L1-normalised ---
  const histogram = new Array(27).fill(0);
  let lumaSum = 0;
  let chromaSum = 0;
  for (const [r, g, b] of pts) {
    const bin = Math.min(2, (r / 86) | 0) * 9 + Math.min(2, (g / 86) | 0) * 3 + Math.min(2, (b / 86) | 0);
    histogram[bin]++;
    lumaSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    chromaSum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  for (let i = 0; i < 27; i++) histogram[i] /= n;

  // --- deterministic farthest-point seeding ---
  const centroids: number[][] = [pts[0].slice()];
  while (centroids.length < k) {
    let best = pts[0];
    let bestD = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const c of centroids) {
        const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (dd < d) d = dd;
      }
      if (d > bestD) { bestD = d; best = p; }
    }
    centroids.push(best.slice());
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const cc = centroids[c];
        const d = (pts[i][0] - cc[0]) ** 2 + (pts[i][1] - cc[1]) ** 2 + (pts[i][2] - cc[2]) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
    }
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
    if (!moved) break;
  }

  const counts = new Array(centroids.length).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;

  const swatches: Swatch[] = centroids
    .map((c, i) => ({
      hex: toHex(c[0], c[1], c[2]),
      r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]),
      pct: counts[i] / n,
    }))
    .filter((s) => s.pct > 0.005)
    .sort((a, b) => b.pct - a.pct);

  return { swatches, histogram, luma: lumaSum / n, chroma: chromaSum / n };
}

/** Bhattacharyya-style distance between two normalised histograms, 0..1. */
export function histDistance(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 1;
  let bc = 0;
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i]);
  return Math.max(0, Math.min(1, 1 - bc));
}

/**
 * Combined visual-similarity score, 0..1.
 * pHash dominates because structure is the stronger signal for "same
 * generation, different roll"; colour breaks ties and separates palette
 * variants of an otherwise identical composition.
 */
export function similarityScore(phashD: number, colorD: number): number {
  const structural = 1 - phashD / 64;
  const chromatic = 1 - colorD;
  return Math.max(0, Math.min(1, structural * 0.72 + chromatic * 0.28));
}
