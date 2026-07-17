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

export function ZoomableContainer({ children }: { children: React.ReactNode }) {
  const [zoomLevel, setZoomLevel] = useState(0.7);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const newZoom = zoomLevel + (delta > 0 ? -0.1 : 0.1);
      setZoomLevel(Math.max(0.5, Math.min(newZoom, 1.1)));
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomLevel]);

  return (
    <ScrollableContainer>
      <div
        ref={containerRef}
        className="smart-zoom-container"
        style={{
          zoom: zoomLevel,
          display: "block",
          width: "100%",
          backgroundColor: "#f9f9f9",
        }}
      >
        {children}
      </div>
    </ScrollableContainer>
  );
}
