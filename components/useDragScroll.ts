"use client";

/*
  Mouse drag-to-scroll for horizontal carousels. Touch already scrolls these
  natively, so this only engages for mouse pointers; after a real drag the
  next click is swallowed so a drag never fires the pill/thumb underneath.
  One hook instance can serve several rows (one pointer drags at a time).
*/

import { useCallback, useRef } from "react";

export function useDragScroll() {
  const s = useRef({ x: 0, left: 0, moved: false, active: false });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    s.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false, active: true };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const st = s.current;
    if (!st.active) return;
    const dx = e.clientX - st.x;
    if (!st.moved && Math.abs(dx) > 5) {
      st.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (st.moved) e.currentTarget.scrollLeft = st.left - dx;
  }, []);

  const onPointerUp = useCallback(() => {
    s.current.active = false;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (s.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      s.current.moved = false;
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture };
}
