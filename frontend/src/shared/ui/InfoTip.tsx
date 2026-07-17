import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleInfo } from "@gravity-ui/icons";
import "./InfoTip.css";

export function InfoTip({
  text,
  label,
}: {
  text: string;
  /** Accessible name when text is long; defaults to "More information" */
  label?: string;
}) {
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const panelWidth = Math.min(280, window.innerWidth - 16);
      let left = rect.left + rect.width / 2 - panelWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
      const placement: "above" | "below" = rect.top > 120 ? "above" : "below";
      setPos({
        left,
        top: placement === "above" ? rect.top - 6 : rect.bottom + 6,
        placement,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, text]);

  if (!text?.trim()) {
    return null;
  }

  return (
    <span
      className="info-tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className="info-tip__button"
        aria-label={label ?? "More information"}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
      >
        <CircleInfo />
      </button>
      {open &&
        createPortal(
          <span
            id={tipId}
            role="tooltip"
            className="info-tip__panel"
            style={
              pos
                ? {
                    left: pos.left,
                    top: pos.top,
                    transform: pos.placement === "above" ? "translateY(-100%)" : "none",
                  }
                : { visibility: "hidden", left: 0, top: 0 }
            }
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
