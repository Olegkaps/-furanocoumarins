import { useEffect, useRef, useState } from "react";
import "./MoleculePreview.css";

/** Small, local depictions; only visible suggestions incur parsing/layout work. */
export function MoleculePreview({ smiles }: { smiles: string }) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [rendered, setRendered] = useState<string>();
  const [failed, setFailed] = useState<string>();
  // Oversized or unsupported molecules retain their selectable SMILES text.
  const bounded = smiles.length <= 1024 && (smiles.match(/Cl|Br|[A-Zbcnops]|\*/g)?.length ?? 0) <= 128;
  const ready = rendered === smiles;
  const unavailable = !bounded || failed === smiles;

  useEffect(() => {
    if (!bounded || !host.current || !svg.current) return;
    let cancelled = false;
    const target = svg.current;
    const draw = async () => {
      try {
        const { default: SmilesDrawer } = await import("smiles-drawer");
        if (cancelled) return;
        SmilesDrawer.parse(smiles, tree => {
          new SmilesDrawer.SvgDrawer({ width: 160, height: 104, padding: 8 }).draw(tree, target, "light");
          if (!cancelled) setRendered(smiles);
        }, () => { if (!cancelled) setFailed(smiles); });
      } catch {
        if (!cancelled) setFailed(smiles);
      }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void draw();
      }
    });
    observer.observe(host.current);
    return () => { cancelled = true; observer.disconnect(); target.replaceChildren(); };
  }, [smiles, bounded]);

  return <div ref={host} className="molecule-preview" role={ready ? "img" : undefined}
    aria-label={ready ? `Molecule structure: ${smiles}` : undefined}>
    <svg ref={svg} aria-hidden="true" focusable="false" style={{ visibility: ready ? "visible" : "hidden" }} />
    {!ready && <span className="molecule-preview__status">{unavailable ? "Preview unavailable" : "Molecule preview"}</span>}
  </div>;
}
