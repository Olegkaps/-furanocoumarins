import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../shared/api";
import { cachedGet } from "../shared/apiCache";
import { guardMetadataCatalog } from "../shared/schemaGuard";
import {
  hasMetadataTypeToken,
  getMetadataTypeModifier,
} from "../shared/metadataType";
import FullNavigation from "../FullNavigation/FullNavigation";
import { PageTour } from "../shared/tour/PageTour";
import { searchLiteral } from "./compareQueries";
import { classificationColumn, classificationSelection, classificationTyped, withClassificationColumn, valueCondition, type ClassificationCondition } from "./classificationAutocomplete";
import { completionKey } from "./queryCompletion";
import {
  StructureOptions,
  defaultStructureOptions,
  structureOperator,
} from "./StructureOptions";
import "./UnifiedSearch.css";

import { StructureDrawer } from "./StructureDrawer";
import { MoleculePreview } from "./MoleculePreview";
import { usePublicConfig } from "../shared/publicConfig";
import { ClassificationAutocompleteNote } from "./ClassificationAutocompleteNote";
type Column = {
  column: string;
  name?: string;
  show_name?: string;
  type: string;
};
type Suggestion = {
  column: string;
  show_name: string;
  value: string;
  text?: string;
  conditions?: ClassificationCondition[];
};
const suggestionKey = (s: Suggestion) => JSON.stringify([s.column, s.value, s.conditions]);
const label = (column: Column) =>
  column.show_name || column.name || column.column;
function group(column: Column) {
  if (
    hasMetadataTypeToken(column.type, "specie") ||
    getMetadataTypeModifier(column.type, "clas")
  )
    return "Species";
  if (
    hasMetadataTypeToken(column.type, "chemical") ||
    hasMetadataTypeToken(column.type, "SMILES")
  )
    return "Chemicals";
  if (
    hasMetadataTypeToken(column.type, "publication") ||
    hasMetadataTypeToken(column.type, "ref[]")
  )
    return "Publications";
  return "Other columns";
}
function SearchApp() {
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [metadataColumns, setMetadataColumns] = useState<Column[]>([]);
  const publicConfig = usePublicConfig();
  const columns = useMemo(
    () => withClassificationColumn(metadataColumns, publicConfig.classification_autocomplete_label),
    [metadataColumns, publicConfig.classification_autocomplete_label],
  );
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState<string[] | null>(null);
  const [structure, setStructure] = useState(false);
  const [options, setOptions] = useState(defaultStructureOptions);
  const [sketch, setSketch] = useState(false);
  const [conditions, setConditions] = useState<Suggestion[]>([]);
  const [combination, setCombination] = useState<"OR" | "AND">("OR");
  const [remote, setRemote] = useState<{
    key: string;
    suggestions: Suggestion[];
    error?: string;
  }>();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    cachedGet("/metadata")
      .then((response) => {
        if (!live) return;
        guardMetadataCatalog(response.data?.metadata, response.data);
        setMetadataColumns((response.data.metadata ?? []).filter((c: Column) => hasMetadataTypeToken(c.type, "search") || hasMetadataTypeToken(c.type, "SMILES")));
      })
      .catch(() => {
        if (live)
          setError("Could not load search columns. Reload to try again.");
      });
    return () => {
      live = false;
    };
  }, []);
  const selectedColumns = useMemo(
    () =>
      columns.filter(
        (c) =>
          (filter === null || filter.includes(c.column)) &&
          (!structure || hasMetadataTypeToken(c.type, "SMILES")),
      ),
    [columns, filter, structure],
  );
  const requestKey = JSON.stringify([
    value.trim(),
    selectedColumns.map((c) => c.column),
    filter === null,
    structure,
    options,
  ]);
  const suggestions = remote?.key === requestKey ? remote.suggestions : [];
  const open = focused && !dismissed && suggestions.length > 0;
  const selected = open && active < suggestions.length ? active : -1;
  useEffect(() => {
    if (!value.trim() || !selectedColumns.length || !focused || dismissed)
      return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await api.get("/autocomplete", {
          signal: controller.signal,
          params: {
            value: value.trim(),
            scope: "search",
            ...(filter === null
              ? {}
              : { columns: selectedColumns.map((c) => c.column).join(",") }),
            ...(structure ? { mode: "structure", ...options } : {}),
          },
        });
        if (!controller.signal.aborted)
          setRemote({
            key: requestKey,
            suggestions: (response.data?.suggestions ?? [])
              .filter(
                (s: Suggestion) =>
                  selectedColumns.some((c) => c.column === s.column) &&
                  typeof s.value === "string" &&
                  (s.column !== classificationColumn || Boolean(classificationSelection(s.conditions, columns))),
              )
              .slice(0, 30),
          });
      } catch (err) {
        if (!controller.signal.aborted)
          setRemote({
            key: requestKey,
            suggestions: [],
            error:
              (err as { response?: { data?: { error?: string } } }).response
                ?.data?.error || "Suggestions unavailable. Please try again.",
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    requestKey,
    focused,
    dismissed,
    value,
    selectedColumns,
    columns,
    filter,
    structure,
    options,
  ]);
  useEffect(() => {
    if (selected >= 0)
      document
        .getElementById(`${id}-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, id]);
  function choose(suggestion: Suggestion) {
    setConditions((previous) =>
      previous.some(
        (s) => suggestionKey(s) === suggestionKey(suggestion),
      )
        ? previous
        : [...previous, suggestion],
    );
    setValue("");
    setActive(-1);
    setError("");
    input.current?.focus();
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if ((!value.trim() && !conditions.length) || (value.trim() && !selectedColumns.length)) {
      setError("Enter a value and select at least one search column.");
      input.current?.focus();
      return;
    }
    const exact = conditions
      .map(
        (s) =>
          s.column === classificationColumn
            ? classificationSelection(s.conditions, columns)
            : valueCondition(columns.find(c => c.column === s.column)!, s.value),
      )
      .join(` ${combination} `);
    const typed = value.trim() ? selectedColumns.map((c) => c.column === classificationColumn
      ? classificationTyped(value.trim(), columns)
      : structure ? `${c.column} ${structureOperator(options)} ${searchLiteral(value.trim())}` : valueCondition(c, value.trim())).join(" OR ") : "";
    const query = [exact, typed ? `(${typed})` : ""].filter(Boolean).join(` ${combination} `);
    navigate(`/table?query=${encodeURIComponent(query)}`);
  }
  return (
    <>
      <FullNavigation pageName="home" />
      <PageTour tourId="search" />
      <form
        onSubmit={submit}
        className="search-form unified-search"
        data-tour="search-form"
      >
        <h2>Search</h2>
        <p>
          Search species, chemicals and publications. Choose a suggestion, or enter a value and search your selected columns.
        </p>
        <div className="unified-search__modes" data-tour="search-structure">
          <button
            type="button"
            aria-pressed={!structure}
            onClick={() => {
              setStructure(false);
              setActive(-1);
            }}
          >
            Text
          </button>
          <button
            type="button"
            aria-pressed={structure}
            disabled={
              !columns.some((c) => hasMetadataTypeToken(c.type, "SMILES"))
            }
            onClick={() => {
              setStructure(true);
              setFilter(null);
              setValue("");
              setActive(-1);
            }}
          >
            SMILES substructure
          </button>
        </div>
        <label htmlFor={id}>
          {structure ? "SMILES substructure" : "Search all values"}
        </label>
        <div className="unified-search__input" data-tour="search-autocomplete">
          <input
            id={id}
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? `${id}-list` : undefined}
            aria-activedescendant={
              selected >= 0 ? `${id}-${selected}` : undefined
            }
            autoComplete="off"
            value={value}
            maxLength={4096}
            placeholder={
              structure
                ? "Paste SMILES or draw a structure"
                : "Type a name, value, or publication text"
            }
            onChange={(e) => {
              setValue(e.target.value);
              setDismissed(false);
              setActive(-1);
              setError("");
            }}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") {
                setDismissed(true);
                setActive(-1);
                e.preventDefault();
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp")
                setDismissed(false);
              const action = completionKey(
                e.key,
                selected,
                open ? suggestions.length : 0,
              );
              if (action.handled) {
                e.preventDefault();
                if (action.choose) choose(suggestions[selected]);
                else setActive(action.active);
              }
            }}
          />
        <button
          type="submit"
          className="btn btn-primary"
          data-tour="search-submit"
        >
          Search
        </button>
          {open && (
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label="Matching database values"
            >
              {suggestions.map((s, i) => (
                <li
                  key={suggestionKey(s)}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                >
                  {columns.some(c => c.column === s.column && hasMetadataTypeToken(c.type, "SMILES")) && <MoleculePreview smiles={s.value} />}
                  <div className="molecule-suggestion__text">
                  <strong>{s.value}</strong>
                  <small>
                    {s.show_name ||
                      label(columns.find((c) => c.column === s.column)!)}
                  </small>
                  {s.text && <span>{s.text}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {columns.length > 0 && selectedColumns.length === 0 && (
          <p role="status">Select at least one column to see suggestions.</p>
        )}
        {remote?.key === requestKey && remote.error && (
          <p role="alert">{remote.error}</p>
        )}
        {value.trim() &&
          remote?.key === requestKey &&
          !remote.error &&
          !suggestions.length && <p role="status">No matching values.</p>}
        {structure && (
          <>
            <StructureOptions value={options} onChange={setOptions} />
            <button type="button" onClick={() => setSketch(true)} aria-haspopup="dialog">Draw structure</button>
            {sketch && <StructureDrawer initialSmiles={value} onClose={() => setSketch(false)} onUse={(smiles) => {
              setValue(smiles); setSketch(false); setDismissed(false); requestAnimationFrame(() => input.current?.focus());
            }} />}
          </>
        )}
        {!structure && <details data-tour="search-section-species">
          <summary>Choose columns ({selectedColumns.length})</summary>
          <button type="button" onClick={() => setFilter(null)}>
            All columns
          </button>
          <button type="button" onClick={() => setFilter([])}>
            Clear columns
          </button>
          {["Species", "Chemicals", "Publications", "Other columns"].map(
            (name) => {
              const members = columns.filter(
                (c) =>
                  group(c) === name &&
                  (!structure || hasMetadataTypeToken(c.type, "SMILES")),
              );
              return (
                members.length > 0 && (
                  <details className="unified-search__group" key={name}>
                    <summary>{name} <small>{members.filter(c => selectedColumns.some(s => s.column === c.column)).length}/{members.length}</small></summary>
                    <div className="unified-search__column-grid">
                    {members.map((c) => (
                      <label key={c.column}>
                        <input
                          type="checkbox"
                          aria-label={c.column === classificationColumn ? label(c) : undefined}
                          aria-describedby={c.column === classificationColumn ? `${id}-generated-classification` : undefined}
                          checked={selectedColumns.some(
                            (s) => s.column === c.column,
                          )}
                          onChange={(e) =>
                            setFilter(
                              e.target.checked
                                ? [
                                    ...selectedColumns.map((s) => s.column),
                                    c.column,
                                  ]
                                : selectedColumns
                                    .filter((s) => s.column !== c.column)
                                    .map((s) => s.column),
                            )
                          }
                        />
                        <span>{label(c)}{c.column === classificationColumn && <ClassificationAutocompleteNote id={`${id}-generated-classification`} />}</span>
                      </label>
                    ))}
                    </div>
                  </details>
                )
              );
            },
          )}
        </details>}
        {conditions.length > 0 && (
          <>
            <fieldset className="unified-search__combination">
              <legend>Match selected values</legend>
              {(["OR", "AND"] as const).map((operator) => (
                <label key={operator}>
                  <input
                    type="radio"
                    name={`${id}-combination`}
                    value={operator}
                    checked={combination === operator}
                    onChange={() => setCombination(operator)}
                  />
                  {operator === "OR" ? "Any (OR)" : "All (AND)"}
                </label>
              ))}
            </fieldset>
            <ul
              className="unified-search__conditions"
              aria-label="Search conditions"
            >
              {conditions.map((s, i) => (
                <li key={suggestionKey(s)}>
                  {i > 0 && <strong>{combination} </strong>}
                  {s.show_name || s.column}: {s.value}{" "}
                  <button
                    type="button"
                    aria-label={`Remove ${s.value}`}
                    onClick={() =>
                      setConditions(conditions.filter((_, index) => index !== i))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p role="alert">{error}</p>}

      </form>
    </>
  );
}
export default SearchApp;
export { AppResultTable } from "./ResultTablePage";
export { AppPhilogeneticTree } from "./TreePage";
