import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { CircleQuestion, Xmark } from "@gravity-ui/icons";
import {
  TOUR_STEPS,
  type TourId,
  type TourPrepare,
  type TourStep,
} from "./tourSteps";
import { isTourDone, markTourDone } from "./tourStorage";
import { useHelpNudge } from "./useHelpNudge";
import "./Tour.css";

type Rect = { top: number; left: number; width: number; height: number };

const CARD_W = 360;
const CARD_H_EST = 240;

function tourEls(step: TourStep): HTMLElement[] {
  const ids = step.targets?.length
    ? step.targets
    : step.target
      ? [step.target]
      : [];
  const out: HTMLElement[] = [];
  for (const id of ids) {
    const el = document.querySelector(
      `[data-tour="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (el) out.push(el);
  }
  return out;
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const pad = 6;
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: Math.max(r.width + pad * 2, 12),
    height: Math.max(r.height + pad * 2, 12),
  };
}

function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return { top, left, width: right - left, height: bottom - top };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function placeCard(
  bound: Rect | null,
  placement: TourStep["placement"],
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);

  if (!bound || placement === "center") {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: w,
      maxHeight: "min(70vh, 420px)",
    };
  }

  const preferSide = placement === "side" || placement === "auto";
  const gap = 14;
  const spaceRight = vw - (bound.left + bound.width) - gap - 8;
  const spaceLeft = bound.left - gap - 8;

  let left: number;
  let top: number;
  let transform = "none";

  if (preferSide && (spaceRight >= w || spaceLeft >= w)) {
    if (spaceRight >= w || spaceRight >= spaceLeft) {
      left = bound.left + bound.width + gap;
    } else {
      left = bound.left - gap - w;
    }
    top = bound.top;
  } else {
    const spaceBelow = vh - (bound.top + bound.height) - gap;
    const preferBelow = spaceBelow > CARD_H_EST || bound.top < 160;
    left = bound.left + bound.width / 2 - w / 2;
    if (preferBelow) {
      top = bound.top + bound.height + gap;
    } else {
      top = bound.top - gap;
      transform = "translateY(-100%)";
    }
  }

  left = clamp(left, 8, vw - w - 8);
  // Keep card body on screen (estimate height).
  if (transform === "translateY(-100%)") {
    top = clamp(top, CARD_H_EST + 8, vh - 8);
  } else {
    top = clamp(top, 8, vh - Math.min(CARD_H_EST, vh * 0.7) - 8);
  }

  return {
    position: "fixed",
    top,
    left,
    transform,
    width: w,
    maxHeight: "min(70vh, 420px)",
  };
}

function dispatchPrepare(action: "enter" | "leave", prepare: TourPrepare) {
  window.dispatchEvent(
    new CustomEvent("fuco-tour", { detail: { action, prepare } }),
  );
}

function TourCard({
  step,
  index,
  total,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const last = index >= total - 1;
  return (
    <div className="page-tour__card" role="dialog" aria-modal="true">
      <div className="page-tour__card-top">
        <p className="page-tour__progress">
          {index + 1} / {total}
        </p>
        <button
          type="button"
          className="page-tour__skip"
          onClick={onSkip}
          title="Skip tour"
          aria-label="Skip tour"
        >
          <Xmark width={16} height={16} />
        </button>
      </div>
      <h2 className="page-tour__title">{step.title}</h2>
      <p className="page-tour__body">{step.body}</p>
      <div className="page-tour__actions">
        <button
          type="button"
          className="btn"
          onClick={onBack}
          disabled={index === 0}
        >
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={onNext}>
          {last ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}

function TourOverlay({
  tourId,
  onClose,
}: {
  tourId: TourId;
  onClose: () => void;
}) {
  const steps = TOUR_STEPS[tourId];
  const [index, setIndex] = useState(0);
  const [rects, setRects] = useState<Rect[]>([]);
  const [cardBox, setCardBox] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const activePrepare = useRef<TourPrepare | null>(null);

  const finish = useCallback(() => {
    if (activePrepare.current) {
      dispatchPrepare("leave", activePrepare.current);
      activePrepare.current = null;
    }
    markTourDone(tourId);
    onClose();
  }, [tourId, onClose]);

  useEffect(() => {
    const prep = step.prepare ?? null;
    const prev = activePrepare.current;
    if (prev && prev !== prep) {
      dispatchPrepare("leave", prev);
      activePrepare.current = null;
    }
    if (prep && prep !== prev) {
      dispatchPrepare("enter", prep);
      activePrepare.current = prep;
    }
  }, [step]);

  useEffect(() => {
    return () => {
      if (activePrepare.current) {
        dispatchPrepare("leave", activePrepare.current);
        activePrepare.current = null;
      }
    };
  }, []);

  const sync = useCallback(() => {
    const els = tourEls(step);
    for (const el of els) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    setRects(els.map(measure));
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      setCardBox({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    }
  }, [step]);

  useLayoutEffect(() => {
    sync();
    const delays = step.prepare ? [80, 200, 400] : [50, 200];
    const timers = delays.map((ms) => window.setTimeout(sync, ms));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [sync, index, step.prepare]);

  useEffect(() => {
    const onResize = () => sync();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [sync]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (index >= steps.length - 1) finish();
        else setIndex((i) => i + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, index, steps.length]);

  const bound = unionRects(rects);
  const cardStyle = placeCard(bound, step.placement ?? "auto");
  const multi = rects.length > 1;
  // One cutout (union) so dimming works; extra rings mark each target when multi.
  const holes = multi && bound ? [bound] : rects;

  const arrows =
    multi && cardBox
      ? rects.map((r, i) => {
          const x1 = cardBox.left + (cardBox.left < r.left ? cardBox.width : 0);
          const y1 = cardBox.top + cardBox.height / 2;
          const x2 = r.left + r.width / 2;
          const y2 = r.top + r.height / 2;
          return (
            <line
              key={i}
              className="page-tour__arrow"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd="url(#page-tour-arrowhead)"
            />
          );
        })
      : null;

  return createPortal(
    <div className="page-tour">
      <div
        className={
          "page-tour__shade" + (holes.length > 0 ? " has-holes" : "")
        }
        aria-hidden
      >
        {holes.map((r, i) => (
          <div
            key={`h-${i}`}
            className="page-tour__hole"
            style={{
              top: Math.max(0, r.top),
              left: Math.max(0, r.left),
              width: r.width,
              height: r.height,
            }}
          />
        ))}
        {multi &&
          rects.map((r, i) => (
            <div
              key={`r-${i}`}
              className="page-tour__ring"
              style={{
                top: Math.max(0, r.top),
                left: Math.max(0, r.left),
                width: r.width,
                height: r.height,
              }}
            />
          ))}
      </div>
      {arrows && (
        <svg className="page-tour__arrows" aria-hidden>
          <defs>
            <marker
              id="page-tour-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-accent)" />
            </marker>
          </defs>
          {arrows}
        </svg>
      )}
      <div ref={cardRef} style={cardStyle}>
        <TourCard
          step={step}
          index={index}
          total={steps.length}
          onBack={() => setIndex((i) => Math.max(0, i - 1))}
          onNext={() => {
            if (index >= steps.length - 1) finish();
            else setIndex((i) => i + 1);
          }}
          onSkip={finish}
        />
      </div>
    </div>,
    document.body,
  );
}

/** Auto-start once per page; floating button to replay. */
export function PageTour({ tourId }: { tourId: TourId }) {
  const [open, setOpen] = useState(false);
  const { nudge, reason, clearNudge } = useHelpNudge(open);

  useEffect(() => {
    if (isTourDone(tourId)) return;
    const t = window.setTimeout(() => setOpen(true), 450);
    return () => window.clearTimeout(t);
  }, [tourId]);

  const openTour = () => {
    clearNudge();
    setOpen(true);
  };

  const nudgeTitle =
    reason === "idle"
      ? "Need a hand? Open the page tour"
      : reason === "rage-click"
        ? "Stuck? The page tour explains the controls"
        : reason === "scroll-thrash"
          ? "Looking for something? Try the page tour"
          : "Show page tour";

  return (
    <>
      <button
        type="button"
        className={`page-tour__help${nudge ? " is-nudge" : ""}`}
        title={nudgeTitle}
        aria-label={nudgeTitle}
        onClick={openTour}
      >
        <CircleQuestion width={22} height={22} />
      </button>
      {open && (
        <TourOverlay tourId={tourId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
