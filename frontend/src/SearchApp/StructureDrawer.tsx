import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./UnifiedSearch.css";
const StructureSketch = lazy(() => import("./StructureSketch"));
export function StructureDrawer({ initialSmiles, onUse, onClose }: { initialSmiles: string; onUse: (smiles: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="structure-drawer" aria-label="Draw substructure" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2>Draw substructure</h2><p>Start from a template or draw a fragment to find matching molecules. Select an end atom and fix its hydrogens to keep that radical from growing; other positions stay open.</p></div><button type="button" onClick={onClose} aria-label="Close structure drawer">×</button></header>
    <Suspense fallback={<p role="status">Loading structure editor…</p>}><StructureSketch initialSmiles={initialSmiles} onUse={onUse} /></Suspense>
  </dialog>, document.body);
}
