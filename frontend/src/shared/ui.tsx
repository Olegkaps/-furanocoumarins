import { useEffect, useRef, useState } from "react";

export function Container({
  children,
  maxHeight = "600px",
  style,
}: {
  children: React.ReactNode;
  maxHeight?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="tree"
      style={{
        backgroundColor: "var(--color-surface)",
        padding: "20px",
        paddingTop: 12,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        maxHeight,
        maxWidth: "100%",
        position: "relative",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ScrollableContainer({
  children,
  maxHeight = "600px",
  height,
}: {
  children: React.ReactNode;
  maxHeight?: string;
  /** Prefer fixed height so scrolling works reliably (table cells ignore max-height). */
  height?: string;
}) {
  return (
    <div
      className="tree scrollable-container"
      style={{
        backgroundColor: "var(--color-surface)",
        padding: "16px",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        height: height ?? undefined,
        maxHeight: height ? undefined : maxHeight,
        maxWidth: "100%",
        overflowX: "auto",
        overflowY: "auto",
        position: "relative",
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

/** Pan/zoom viewport: wheel zooms toward cursor, drag pans. No native scrollbars. */
export function ZoomableContainer({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  scaleRef.current = scale;
  panRef.current = pan;

  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldScale = scaleRef.current;
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      const newScale = Math.min(2.8, Math.max(0.2, oldScale * factor));
      if (newScale === oldScale) return;

      const { x: panX, y: panY } = panRef.current;
      const contentX = (mx - panX) / oldScale;
      const contentY = (my - panY) / oldScale;
      const newPan = {
        x: mx - contentX * newScale,
        y: my - contentY * newScale,
      };
      scaleRef.current = newScale;
      panRef.current = newPan;
      setScale(newScale);
      setPan(newPan);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("a, button, input, select, textarea, label")) return;
      dragging.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add("is-panning");
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      const next = {
        x: panRef.current.x + dx,
        y: panRef.current.y + dy,
      };
      panRef.current = next;
      setPan(next);
    };

    const endPan = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      el.classList.remove("is-panning");
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
    };
  }, []);

  return (
    <div ref={viewportRef} className="tree-viewport" title="Drag to pan, scroll to zoom">
      <div
        className="tree-viewport__canvas"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
