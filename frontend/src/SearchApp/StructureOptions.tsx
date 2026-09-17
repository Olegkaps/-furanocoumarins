export const defaultStructureOptions = {
  bond_order: false,
  hetero_atoms: false,
  stereochemistry: false,
};
export type StructureSearchOptions = typeof defaultStructureOptions;
export const structureTemplates = [
  { name: "Psoralen", smiles: "C1=CC(=O)OC2=CC3=C(C=CO3)C=C21" },
  { name: "Angelicin", smiles: "C1=CC2=C(C=CO2)C3=C1C=CC(=O)O3" },
];
export function StructureOptions({
  value,
  onChange,
}: {
  value: StructureSearchOptions;
  onChange: (value: StructureSearchOptions) => void;
}) {
  return (
    <fieldset className="structure-options">
      <legend>Substructure matching</legend>
      <label>
        <input
          type="checkbox"
          checked={value.bond_order}
          onChange={(e) => onChange({ ...value, bond_order: e.target.checked })}
        />
        Match bond multiplicity
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.hetero_atoms}
          onChange={(e) =>
            onChange({ ...value, hetero_atoms: e.target.checked })
          }
        />
        Allow carbon to match heteroatoms
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.stereochemistry}
          onChange={(e) =>
            onChange({ ...value, stereochemistry: e.target.checked })
          }
        />
        Match stereochemistry
      </label>
      <small>
        Explicit heteroatoms, hydrogen counts and multiple bonds must always match.
        {" "}Use <code>O[CH3]</code> to keep a methyl end from extending to <code>OCC</code>.
        {" "}Unmarked positions still allow substitutions.
      </small>
    </fieldset>
  );
}

export function structureOperator(options: StructureSearchOptions) {
  const flags = [options.bond_order && "bonds", options.hetero_atoms && "hetero", options.stereochemistry && "stereo"].filter(Boolean);
  return `SUBSTRUCTURE${flags.length ? `[${flags.join(",")}]` : ""}`;
}

export function parseStructureOptions(operator?: string): StructureSearchOptions {
  const legacy = operator?.match(/^SUBSTRUCTURE\[bond_multiplicity=(true|false),hetero_atoms=(true|false),stereochemistry=(true|false)\]$/);
  if (legacy) return { bond_order: legacy[1] === "true", hetero_atoms: legacy[2] === "true", stereochemistry: legacy[3] === "true" };
  const flags = operator?.match(/^SUBSTRUCTURE\[([^\]]+)\]$/)?.[1].split(",") ?? [];
  return { bond_order: flags.includes("bonds"), hetero_atoms: flags.includes("hetero"), stereochemistry: flags.includes("stereo") };
}

/** Quoted values are opaque, including escaped apostrophes and unfinished literals. */
export function compactStructureQuery(query: string) {
  return query.replace(/'(?:[^']|'')*'?|\bSUBSTRUCTURE\[bond_multiplicity=(?:true|false),hetero_atoms=(?:true|false),stereochemistry=(?:true|false)\]/g,
    token => token.startsWith("'") ? token : structureOperator(parseStructureOptions(token)));
}
