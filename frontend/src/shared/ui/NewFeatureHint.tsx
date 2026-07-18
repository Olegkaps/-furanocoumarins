import type { ReactNode } from "react";
import "./NewFeatureHint.css";

/**
 * Decorator that draws attention to a new capability.
 * Wrap the control that introduces the feature (not the whole page).
 */
export function NewFeatureHint({
  children,
  label = "New",
  tip,
}: {
  children: ReactNode;
  label?: string;
  tip?: string;
}) {
  return (
    <div className="new-feature-hint" title={tip}>
      <span className="new-feature-hint__badge" aria-hidden>
        {label}
      </span>
      <div className="new-feature-hint__body">{children}</div>
    </div>
  );
}
