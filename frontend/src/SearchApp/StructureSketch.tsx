import { useEffect, useRef, useState } from "react";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import { AtomAttr, fromAtomsAttrs, type Ketcher } from "ketcher-core";
import "ketcher-react/dist/index.css";
import { structureTemplates } from "./StructureOptions";
import { exportDrawerStructure, loadDrawerStructure } from "./drawerHydrogens";
const provider = new StandaloneStructServiceProvider();
export default function StructureSketch({
  initialSmiles,
  onUse,
}: {
  initialSmiles: string;
  onUse: (smiles: string) => void;
}) {
  const editor = useRef<Ketcher | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [fixedCount, setFixedCount] = useState(0);
  const unsubscribe = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubscribe.current?.(), []);
  const refreshAtoms = () => {
    const drawing = editor.current?.editor;
    setSelectedCount(drawing?.selection()?.atoms?.length ?? 0);
    setFixedCount(drawing ? [...drawing.struct().atoms.values()].filter(atom => (atom.implicitHCount ?? 0) > 0).length : 0);
  };
  const fixHydrogens = (fixed: boolean) => {
    const drawing = editor.current?.editor;
    const ids = drawing?.selection()?.atoms ?? [];
    if (!drawing || !ids.length) {
      setError("Select an atom in the drawing first.");
      return;
    }
    if (fixed && ids.some(id => (drawing.struct().atoms.get(id)?.implicitH ?? 0) <= 0)) {
      setError("Select atoms with hydrogens, such as a methyl end (CH3) or hydroxyl (OH).");
      return;
    }
    try {
      const action = fromAtomsAttrs(drawing.render.ctab, ids[0], { implicitHCount: fixed ? drawing.struct().atoms.get(ids[0])!.implicitH : null }, false);
      for (const id of ids.slice(1)) {
        action.mergeWith(fromAtomsAttrs(drawing.render.ctab, id, { implicitHCount: fixed ? drawing.struct().atoms.get(id)!.implicitH : null }, false));
      }
      // Ketcher restores implicit H for aromatic atoms inside fromAtomsAttrs.
      // An explicit removal must clear that value after its normal updates.
      if (!fixed) for (const id of ids) action.addOp(new AtomAttr(id, "implicitHCount", null).perform(drawing.render.ctab));
      drawing.update(action);
      setError("");
      refreshAtoms();
    } catch {
      setError("Could not change the selected atoms. Try selecting them again.");
    }
  };
  return (
    <section aria-label="Structure sketcher" className="structure-sketch">
      <div className="unified-search__templates">
        {structureTemplates.map(t => <span key={t.name}>
          <button type="button" disabled={!ready} onClick={async () => {
            setReady(false);
            try { await loadDrawerStructure(editor.current!, t.smiles); refreshAtoms(); setError(""); }
            catch { setError("Could not load this template."); }
            finally { setReady(true); }
          }}>{t.name}</button>
          <button type="button" aria-label={`Copy ${t.name} SMILES`} onClick={() => navigator.clipboard.writeText(t.smiles).catch(() => setError("Clipboard unavailable. Use the template and copy the SMILES input."))}>Copy</button>
        </span>)}
      </div>
      <fieldset className="structure-sketch__hydrogens">
        <legend>Keep a radical from growing</legend>
        <p>Select its end atom in the drawing, then fix its hydrogens. A methyl end becomes [CH3], excluding longer chains; other positions stay open.</p>
        <div>
          <button type="button" disabled={!ready || selectedCount === 0} onClick={() => fixHydrogens(true)}>Fix selected hydrogens</button>
          <button type="button" disabled={!ready || selectedCount === 0} onClick={() => fixHydrogens(false)}>Remove selected hydrogen fixes</button>
          <span role="status">{selectedCount} selected · {fixedCount} fixed</span>
        </div>
      </fieldset>
      <p className="structure-sketch__hint">
        Scroll sideways inside the editor to reach all drawing tools.
      </p>
      <div className="structure-sketch__viewport">
        <div className="structure-sketch__editor">
          <Editor
            errorHandler={() =>
              setError("The structure editor could not complete that action.")
            }
            staticResourcesUrl="/"
            structServiceProvider={provider}
            onInit={async (ketcher) => {
              editor.current = ketcher;
              const selectionSubscription = ketcher.editor.subscribe("selectionChange", refreshAtoms);
              const changeSubscription = ketcher.editor.subscribe("change", refreshAtoms);
              unsubscribe.current = () => {
                ketcher.editor.unsubscribe("selectionChange", selectionSubscription);
                ketcher.editor.unsubscribe("change", changeSubscription);
              };
              try {
                if (initialSmiles.trim())
                  await loadDrawerStructure(ketcher, initialSmiles);
                else ketcher.editor.clear();
              } catch {
                ketcher.editor.clear();
                setError(
                  "The SMILES could not be loaded. Draw a structure or correct the input.",
                );
              }
              refreshAtoms();
              setReady(true);
            }}
          />
        </div>
      </div>
      <div className="structure-sketch__actions">
        <button
          type="button"
          disabled={!ready}
          onClick={async () => {
            try {
              const smiles = await exportDrawerStructure(editor.current!);
              if (!smiles.trim()) {
                setError("Draw a structure first.");
                return;
              }
              onUse(smiles);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not export this structure as SMILES. Remove incompatible hydrogen fixes and try again.");
            }
          }}
        >
          Use drawn structure
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
