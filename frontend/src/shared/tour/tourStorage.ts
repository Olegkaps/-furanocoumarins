import type { TourId } from "./tourSteps";

export type { TourId };

const LS_PREFIX = "fuco-tour:v1:";

export function isTourDone(tourId: TourId): boolean {
  try {
    return localStorage.getItem(LS_PREFIX + tourId) === "done";
  } catch {
    return false;
  }
}

export function markTourDone(tourId: TourId): void {
  try {
    localStorage.setItem(LS_PREFIX + tourId, "done");
  } catch {
    /* ignore */
  }
}

export function resetTour(tourId: TourId): void {
  try {
    localStorage.removeItem(LS_PREFIX + tourId);
  } catch {
    /* ignore */
  }
}
