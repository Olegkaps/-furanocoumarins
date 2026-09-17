import { usePublicConfig } from "../shared/publicConfig";

export function ClassificationAutocompleteNote({ id }: { id: string }) {
  const { classification_autocomplete_hint: hint } = usePublicConfig();
  return hint ? <small id={id} className="unified-search__generated-note">{hint}</small> : null;
}
