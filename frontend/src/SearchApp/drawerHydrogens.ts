import type { ChemicalMimeType, Ketcher } from "ketcher-core";

type Drawer = Pick<Ketcher, "getKet" | "getSmiles" | "setMolecule" | "structService">;
type Atom = { isotope?: number; implicitHCount?: number; [key: string]: unknown };
type Mark = { isotope: number; hydrogens: number };
const ketFormat = "chemical/x-indigo-ket" as ChemicalMimeType;
const smilesFormat = "chemical/x-daylight-smiles" as ChemicalMimeType;
const bracket = /^(\d*)([A-Z][a-z]?|se|as|[bcnops*])(@(?:@|(?:TH|AL|SP|TB|OH)\d+)?)?(H(\d*)?)?([+-]+\d*)?(:\d+)?$/;
const lostConstraint = "Could not preserve fixed hydrogens. Clear or reapply the atom constraint before using this drawing.";

function atoms(ket: Record<string, unknown>): Atom[] {
  return Object.values(ket).flatMap(node => node && typeof node === "object" && "atoms" in node && Array.isArray(node.atoms) ? node.atoms as Atom[] : []);
}
function firstMarker(isotopes: number[]) {
  const start = Math.max(1000, ...isotopes) + 1;
  if (!Number.isSafeInteger(start) || start > 60000) throw new Error(lostConstraint);
  return start;
}
function hydrogenCount(match: RegExpMatchArray) {
  return match[4] ? Number(match[5] || 1) : 0;
}

/** Indigo drops normal-molecule atom maps and implicitHCount during SMILES
 * conversion. Unique temporary isotopes keep atom identities across reordering.
 * They exist only in conversion copies, are checked, and never reach the editor
 * or the returned search query. Unmarked atoms use normal Indigo serialization. */
export async function loadDrawerStructure(editor: Drawer, smiles: string) {
  const tokens = [...smiles.matchAll(/\[([^\]]+)\]/g)];
  if (!tokens.some(t => { const match = t[1].match(bracket); return match && hydrogenCount(match) > 0; })) { await editor.setMolecule(smiles); return; }
  let next = firstMarker(tokens.map(t => Number(t[1].match(/^\d+/)?.[0] || 0)));
  const marks = new Map<number, Mark>();
  const tagged = smiles.replace(/\[([^\]]+)\]/g, (token, body: string) => {
    const match = body.match(bracket);
    if (!match || hydrogenCount(match) === 0) return token;
    const id = next++;
    marks.set(id, { isotope: Number(match[1] || 0), hydrogens: hydrogenCount(match) });
    return `[${id}${body.slice(match[1].length)}]`;
  });
  if (!marks.size) { await editor.setMolecule(smiles); return; }
  const result = await editor.structService.layout({ struct: tagged, output_format: ketFormat });
  const ket = JSON.parse(result.struct) as Record<string, unknown>;
  const seen = new Set<number>();
  for (const atom of atoms(ket)) {
    const id = atom.isotope ?? 0;
    const mark = marks.get(id);
    if (!mark) continue;
    if (seen.has(id)) throw new Error(lostConstraint);
    seen.add(id);
    if (mark.isotope) atom.isotope = mark.isotope; else delete atom.isotope;
    atom.implicitHCount = mark.hydrogens;
  }
  if (seen.size !== marks.size) throw new Error(lostConstraint);
  await editor.setMolecule(JSON.stringify(ket));
}

export async function exportDrawerStructure(editor: Drawer): Promise<string> {
  const ket = JSON.parse(await editor.getKet()) as Record<string, unknown>;
  const allAtoms = atoms(ket);
  if (!allAtoms.some(atom => atom.implicitHCount != null)) return editor.getSmiles();
  let next = firstMarker(allAtoms.map(atom => atom.isotope ?? 0));
  const marks = new Map<number, Mark>();
  for (const atom of allAtoms) {
    const count = atom.implicitHCount;
    if (count == null) continue;
    if (!Number.isInteger(count) || count <= 0 || count > 8) throw new Error(lostConstraint);
    marks.set(next, { isotope: atom.isotope ?? 0, hydrogens: count });
    atom.isotope = next++;
    delete atom.implicitHCount;
  }
  if (!marks.size) return editor.getSmiles();
  const result = await editor.structService.convert({ struct: JSON.stringify(ket), output_format: smilesFormat });
  const seen = new Set<number>();
  const smiles = result.struct.replace(/\[([^\]]+)\]/g, (token, body: string) => {
    const match = body.match(bracket);
    if (!match) throw new Error(lostConstraint);
    const id = Number(match[1] || 0);
    const mark = marks.get(id);
    if (!mark) return token;
    if (seen.has(id) || hydrogenCount(match) !== mark.hydrogens) throw new Error(lostConstraint);
    seen.add(id);
    return `[${mark.isotope || ""}${body.slice(match[1].length)}]`;
  });
  if (seen.size !== marks.size) throw new Error(lostConstraint);
  return smiles;
}
