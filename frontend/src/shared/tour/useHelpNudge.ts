import { useEffect, useRef, useState } from "react";

type NudgeReason = "idle" | "rage-click" | "scroll-thrash" | null;

const IDLE_MS = 28_000;
const GRACE_MS = 8_000;
const RAGE_WINDOW_MS = 1_200;
const RAGE_COUNT = 3;
const RAGE_RADIUS_PX = 28;
const SCROLL_THRASH_MS = 8_000;
const SCROLL_DIRECTION_FLIPS = 6;
const NUDGE_COOLDOWN_MS = 90_000;

/**
 * Lightweight “user seems stuck” heuristics → pulse the help button.
 * Disabled while `paused` (e.g. tour overlay open).
 */
export function useHelpNudge(paused: boolean): {
  nudge: boolean;
  reason: NudgeReason;
  clearNudge: () => void;
} {
  const [nudge, setNudge] = useState(false);
  const [reason, setReason] = useState<NudgeReason>(null);
  const lastActivity = useRef(Date.now());
  const lastNudgeAt = useRef(0);
  const mountedAt = useRef(Date.now());
  const clicks = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const scrollDir = useRef<Array<{ t: number; dir: 1 | -1 }>>([]);
  const lastScrollY = useRef(window.scrollY);

  const clearNudge = () => {
    setNudge(false);
    setReason(null);
  };

  const maybeNudge = (why: Exclude<NudgeReason, null>) => {
    if (paused) return;
    const now = Date.now();
    if (now - mountedAt.current < GRACE_MS) return;
    if (now - lastNudgeAt.current < NUDGE_COOLDOWN_MS) return;
    lastNudgeAt.current = now;
    setReason(why);
    setNudge(true);
  };

  const markActivity = () => {
    lastActivity.current = Date.now();
  };

  useEffect(() => {
    if (paused) {
      clearNudge();
      markActivity();
      return;
    }

    const onPointer = (e: PointerEvent) => {
      markActivity();
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Ignore the help button itself
      const t = e.target as Element | null;
      if (t?.closest?.(".page-tour__help")) return;

      const now = Date.now();
      clicks.current.push({ t: now, x: e.clientX, y: e.clientY });
      clicks.current = clicks.current.filter((c) => now - c.t < RAGE_WINDOW_MS);
      if (clicks.current.length >= RAGE_COUNT) {
        const [a, , c] = [
          clicks.current[0],
          clicks.current[1],
          clicks.current[clicks.current.length - 1],
        ];
        const near =
          Math.hypot(a.x - c.x, a.y - c.y) < RAGE_RADIUS_PX * 2 &&
          clicks.current.every(
            (p) => Math.hypot(p.x - a.x, p.y - a.y) < RAGE_RADIUS_PX * 2,
          );
        if (near) {
          clicks.current = [];
          maybeNudge("rage-click");
        }
      }
    };

    const onKey = () => markActivity();

    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastScrollY.current;
      lastScrollY.current = y;
      if (Math.abs(dy) < 8) return;
      markActivity();
      const dir: 1 | -1 = dy > 0 ? 1 : -1;
      const now = Date.now();
      const prev = scrollDir.current[scrollDir.current.length - 1];
      if (!prev || prev.dir !== dir) {
        scrollDir.current.push({ t: now, dir });
      }
      scrollDir.current = scrollDir.current.filter(
        (s) => now - s.t < SCROLL_THRASH_MS,
      );
      if (scrollDir.current.length >= SCROLL_DIRECTION_FLIPS) {
        scrollDir.current = [];
        maybeNudge("scroll-thrash");
      }
    };

    const idleTimer = window.setInterval(() => {
      if (paused) return;
      if (Date.now() - lastActivity.current >= IDLE_MS) {
        maybeNudge("idle");
        // Don't re-fire idle every tick — reset activity clock softly
        lastActivity.current = Date.now();
      }
    }, 2000);

    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.clearInterval(idleTimer);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [paused]);

  return { nudge, reason, clearNudge };
}
