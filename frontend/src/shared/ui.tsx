import { useEffect, useRef, useState } from "react";

export function Container({
  children,
  maxHeight = "600px",
}: {
  children: React.ReactNode;
  maxHeight?: string;
}) {
  return (
    <div
      className="tree"
      style={{
        backgroundColor: "white",
        padding: "30px",
        paddingTop: 0,
        border: "1px solid #d4d4d4ff",
        borderRadius: "20px",
        maxHeight,
        maxWidth: "100%",
        position: "relative",
      }}
    >
      {children}
    </div>
  );
}

export function ScrollableContainer({
  children,
  maxHeight = "600px",
}: {
  children: React.ReactNode;
  maxHeight?: string;
}) {
  return (
    <div
      className="tree"
      style={{
        backgroundColor: "white",
        padding: "30px",
        paddingTop: 0,
        border: "1px solid #d4d4d4ff",
        borderRadius: "20px",
        maxHeight,
        maxWidth: "100%",
        overflow: "scroll",
        position: "relative",
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
