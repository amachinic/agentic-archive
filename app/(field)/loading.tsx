/*
  The instant loading state for the workspace.

  Without this file Next has no Suspense boundary to fall back to, so a
  click on Network blocks until the server has finished forming the whole
  field -- measured on the deployed archive at 3.86 SECONDS during which
  nothing at all happens: the URL does not change, the sidebar does not
  mark the page, the click appears to have missed. The bundled docs are
  explicit that the fallback is prefetched and "navigation is immediate".

  So: the click now commits at once. The sidebar marks Network, the
  workspace fills with the field's own silhouette, and the real canvas
  swaps in underneath when it arrives.

  The scatter is DETERMINISTIC. A Math.random() layout would differ
  between the server's HTML and the client's first render, and a skeleton
  that flickers into a different arrangement is worse than none.
*/

const CARDS = 26;

/* the same cheap integer hash the idents use, so the scatter is stable
   across every render and every runtime */
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export default function Loading() {
  return (
    <div className="fieldskel" role="status" aria-label="Forming the field">
      {/* the rail's ground, so the top of the page does not jump when the
          real one arrives */}
      <div className="fieldskel__rail" />
      <div className="fieldskel__field" aria-hidden="true">
        {Array.from({ length: CARDS }, (_, i) => {
          /* a loose scatter rather than a grid: the field is a scatter, and
             a skeleton that lies about the shape of what is coming is just
             a different kind of surprise */
          const left = 4 + hash(i, 1) * 88;
          const top = 6 + hash(i, 2) * 84;
          const w = 58 + hash(i, 3) * 54;
          const ratio = 0.66 + hash(i, 4) * 0.5;
          return (
            <span
              key={i}
              className="fieldskel__card"
              style={{
                left: left + "%",
                top: top + "%",
                width: w + "px",
                height: Math.round(w * ratio) + "px",
                animationDelay: (hash(i, 5) * 900).toFixed(0) + "ms",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
