import { useState } from "react";
import { Link } from "react-router-dom";
import { FileArrowUp, ArrowUpRightFromSquare, Molecule, BranchesRight, BookOpen } from '@gravity-ui/icons';
import { isEmpty } from "../shared/api";
import { Container, ScrollableContainer } from "../shared/ui";
import config from "../config";
import DataMeta from "./DataMeta";
import DataRows from "./RowsData";
import { type CountMode } from "./PhylogeneticTree";
import { InfoTip } from "../shared/ui/InfoTip";
import { substancePagePath } from "../shared/substanceUrl";

function collectUniqueTokensFromRow(row: Map<string, string>, columnNames: string[], into: Set<string>) {
  columnNames.forEach((col) => {
    const v = row.get(col)
    if (v != null && String(v).trim() !== "") {
      String(v).split(/\s*,\s*/).forEach((s) => {
        const t = s.trim()
        if (t) into.add(t)
      })
    }
  })
}

function uniqueArticleCountForSpecie(rows: DataRows[], specie: string, refColumns: string[]): number {
  const merged = new Set<string>()
  rows.forEach((dr) => {
    if (dr.specie_val !== specie) return
    dr.value_rows.forEach((row) => collectUniqueTokensFromRow(row, refColumns, merged))
  })
  return merged.size
}

function uniqueArticleCountForChemical(rows: DataRows[], chemical: string, refColumns: string[]): number {
  const merged = new Set<string>()
  rows.forEach((dr) => {
    if (dr.chemical_val !== chemical) return
    dr.value_rows.forEach((row) => collectUniqueTokensFromRow(row, refColumns, merged))
  })
  return merged.size
}

function countLabelForSpecie(rows: DataRows[], specie: string, mode: CountMode, refColumns: string[]): number {
  const subset = rows.filter((dr) => dr.specie_val === specie)
  if (mode === "chemicals") {
    return new Set(subset.map((dr) => dr.chemical_val)).size
  }
  if (mode === "articles") {
    return uniqueArticleCountForSpecie(rows, specie, refColumns)
  }
  return subset.reduce((acc, dr) => acc + dr.total_length, 0)
}

function countLabelForChemical(rows: DataRows[], chemical: string, mode: CountMode, refColumns: string[]): number {
  const subset = rows.filter((dr) => dr.chemical_val === chemical)
  if (mode === "chemicals") {
    return new Set(subset.map((dr) => dr.specie_val)).size
  }
  if (mode === "articles") {
    return uniqueArticleCountForChemical(rows, chemical, refColumns)
  }
  return subset.reduce((acc, dr) => acc + dr.total_length, 0)
}

type SelectOption = { value: string; count: number }


function ResultTableHead({meta}: {meta: Array<DataMeta>}) {
  return <thead style={{position: 'sticky', top: 0, zIndex: 900}}>
    <tr>
      { meta.map((curr_meta) => {
        if (curr_meta.is_grouping || curr_meta.is_ignore) {
          return <></>
        }
        const HeaderIcon =
          curr_meta.type === "reference" ? BookOpen
          : curr_meta.type === "smiles" ? Molecule
          : null;
        return <th scope='col' style={{backgroundColor: "var(--color-table-header)", padding: "0 8px"}}>
          <p style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            fontFamily: "var(--font-serif)",
            margin: "14px 0",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
            {HeaderIcon && <HeaderIcon width={18} height={18} aria-hidden />}
            {curr_meta.show_name}&nbsp;<InfoTip text={curr_meta.description} />
          </p>
        </th>
    })}
    </tr>
  </thead>
}


function ResultTableBody({ rows, meta }: {rows: Array<Map<string, string>>, meta: Array<DataMeta>}) {
  return <tbody>
    { rows.map((row) => (
      <tr>
        { meta.map((meta_val, ind) => {
          if (meta_val.is_grouping || meta_val.is_ignore) {
            return <></>
          }
          const isRef = meta_val.type === "reference";
          return <td style={{
            minWidth: isRef ? "200px" : "120px",
            maxWidth: isRef ? "360px" : "220px",
            width: isRef ? "32%" : undefined,
            textAlign: isRef ? "left" : undefined,
          }}>
            {meta[ind].render(row.get(meta_val.name))}
          </td>
        })}
      </tr>
    ))}
  </tbody>

}


function ResultTable({ rows, meta }: {rows: Array<Map<string, string>>, meta: Array<DataMeta>}) {
  if (meta.length === 0) {
    return <div></div>
  }

  return <div className='table'>
    <table style={{margin: 'auto'}}>
      {rows.length === 0 ?
        <caption style={{padding: '20%', border: '1px solid #d4d4d4ff', fontSize: config["FONT_SIZE"], backgroundColor: 'white', minWidth: '300px'}}>No data for given request</caption>
      :
      <>
        <ResultTableHead {...{meta: meta}} />
        <ResultTableBody {...{meta: meta, rows: rows}} />
      </>
      }
    </table>
  </div>
}


function GroupedResultTable(
  { rows, meta, currentSpecie, currentChemical }:
  {
    rows: Array<DataRows>,
    meta: Array<DataMeta>,
    currentSpecie: string,
    currentChemical: string,
  }
) {
  if (currentSpecie === "" && currentChemical === "") {
    return <p className="empty-state">Select species or chemical</p>
  }

  let filteredRows: DataRows[] = []
  rows.forEach((data_rows) => {
    let specie_ok = false
    let chemical_ok = false
    if (currentSpecie == "" || currentSpecie == data_rows.specie_val) {
      specie_ok = true
    }
    if (currentChemical == "" || currentChemical == data_rows.chemical_val) {
      chemical_ok = true
    }
    if (specie_ok && chemical_ok) {
      filteredRows.push(data_rows)
    }
  })

  let smiles_ind = -1
  meta.forEach((meta_val, ind) => {
    if (meta_val.type === "smiles") {
      smiles_ind = ind
    }
  })

  return <>{filteredRows.map((dataRows, row_ind) => (
    <div key={row_ind} style={{ marginBottom: 16 }}>
      <br></br>
      {dataRows.chemical_row.size * dataRows.specie_row.size > 0 ?
      <div
        className="grouped-result-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          width: "100%",
        }}
      >
        <Container
          maxHeight="500px"
          style={{
            flex: "1 1 320px",
            minWidth: 280,
            maxWidth: 440,
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          <p style={{ textAlign: "center", marginTop: 0 }}>
            <span className="badge badge-chemical">
              <Molecule width={16} height={16} aria-hidden />
              Chemical
            </span>
          </p>
          {(() => {
            const smiles = dataRows.chemical_row.get(meta[smiles_ind].name) ?? "";
            return smiles ? (
              <p style={{ textAlign: "center", marginTop: 8, marginBottom: 12 }}>
                <Link
                  to={substancePagePath(smiles)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-button"
                >
                  Open substance page
                  <ArrowUpRightFromSquare />
                </Link>
              </p>
            ) : null;
          })()}
          <table style={{ width: "100%", tableLayout: "fixed" }}>
            <tbody>
              {meta.map((meta_val, ind) => {
                if (!meta_val.is_chemical || meta_val.type === "smiles") {
                  return
                }
                return (
                  <tr key={meta_val.name}>
                    <td style={{ width: "42%", wordBreak: "break-word" }}>
                      <InfoTip text={meta_val.description} />
                      &nbsp;{meta_val.show_name}
                    </td>
                    <td style={{ width: "58%", wordBreak: "break-word" }}>
                      {meta[ind].render(dataRows.chemical_row.get(meta_val.name))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Container>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: "0 1 420px",
            minWidth: 320,
            maxWidth: 480,
            minHeight: 0,
          }}
        >
          <Container>
            {meta[smiles_ind].render(
              dataRows.chemical_row.get(meta[smiles_ind].name),
            )}
          </Container>
          <ScrollableContainer height="320px">
            <ResultTable {...{ rows: dataRows.value_rows, meta: meta }} />
          </ScrollableContainer>
        </div>

      <Container
        maxHeight="500px"
        style={{
          flex: "1 1 320px",
          minWidth: 280,
          maxWidth: 440,
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        <p style={{ textAlign: "center", marginTop: 0 }}>
          <span className="badge badge-species">
            <BranchesRight width={16} height={16} aria-hidden />
            Species
          </span>
        </p>
        <table style={{ width: "100%", tableLayout: "fixed" }}>
          <tbody>
            {meta.map((meta_val, ind) => {
              if (!meta_val.is_specie) {
                return
              }
              return (
                <tr key={meta_val.name}>
                  <td style={{ width: "42%", wordBreak: "break-word" }}>
                    <InfoTip text={meta_val.description} />
                    &nbsp;{meta_val.show_name}
                  </td>
                  <td style={{ width: "58%", wordBreak: "break-word" }}>
                    {meta[ind].render(dataRows.specie_row.get(meta_val.name))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Container>

      </div>

      :

      <ScrollableContainer height="400px">
        <ResultTable {...{rows: dataRows.value_rows, meta: meta}}/>
      </ScrollableContainer>

      }
        {row_ind < filteredRows.length &&
          <>
            <br></br>
            <hr style={{border: '1px solid var(--color-border)'}}></hr>
            <br></br>
          </>
        }
      </div>
    ))}</>
}


function escapeTsvField(value: string): string {
  if (/[\t\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function loadDataRowsAsTSV(rows: Array<DataRows>, meta: Array<DataMeta>) {
  const lines: string[] = [];
  lines.push(meta.map((curr_meta) => escapeTsvField(curr_meta.name)).join("\t"));

  rows.forEach((dataRows) => {
    dataRows.value_rows.forEach((currRow) => {
      const parsedRow = meta.map((curr_meta) => {
        let value: string | undefined;
        if (curr_meta.is_chemical) {
          value = dataRows.chemical_row.get(curr_meta.name);
        } else if (curr_meta.is_specie) {
          value = dataRows.specie_row.get(curr_meta.name);
        } else {
          value = currRow.get(curr_meta.name);
        }
        return escapeTsvField(value === undefined ? "" : String(value));
      });
      lines.push(parsedRow.join("\t"));
    });
  });

  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/tab-separated-values;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "results.tsv";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function filterCountMode(countMode: CountMode, from: CountMode, to: string) {
  if (countMode === from) {
    return to
  }
  return countMode
}

function TableStateBar(
  { rows, meta, currentSpecie, setCurrentSpecie, speciesOptions, currentChemical, setCurrentChemical, chemicalsOptions, countMode, setCountMode }:
  {
    rows: DataRows[],
    meta: DataMeta[],
    currentSpecie: string,
    setCurrentSpecie: React.Dispatch<React.SetStateAction<string>>,
    speciesOptions: SelectOption[],
    currentChemical: string,
    setCurrentChemical: React.Dispatch<React.SetStateAction<string>>,
    chemicalsOptions: SelectOption[],
    countMode: CountMode,
    setCountMode: React.Dispatch<React.SetStateAction<CountMode>>,
  }
) {
  let total_rows = 0
  rows.forEach((data_rows) => {
    if (currentChemical != "" && data_rows.chemical_val != currentChemical ) {
      return
    }
    if (currentSpecie != "" && data_rows.specie_val != currentSpecie ) {
      return
    }
    total_rows += data_rows.total_length
  })

  let chemical_key = rows[0].chemical_key
  let specie_key = rows[0].specie_key
  return <div className="panel panel-toolbar">

  <span>Count in lists: </span>
  {(["chemicals", "articles", "all"] as const).map((mode) => (
    <button
      key={mode}
      type="button"
      className={`btn-toggle${mode === countMode ? " is-active" : ""}`}
      onClick={() => { setCountMode(mode) }}
    >{filterCountMode(mode, "chemicals", "chemicals / species")}</button>
  ))}

  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    Download results:
    <button
      type="button"
      className="btn"
      onClick={() => loadDataRowsAsTSV(rows, meta)}
      title="Download TSV"
      aria-label="Download TSV"
    >
        <FileArrowUp style={{ width: 22, height: 22 }} />
      </button>
  </label>

  <label style={{color: 'var(--color-success)'}}>Rows in selection:&nbsp;&nbsp;<b>{total_rows}</b>
  </label>

  <span className="panel-toolbar__break" aria-hidden />

  <label style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
    <BranchesRight width={16} height={16} aria-hidden />
    Species ({specie_key}):&nbsp;
    {
      speciesOptions.length > 1 ?
      <select
        value={currentSpecie}
        onChange={e => setCurrentSpecie(e.target.value)}
        style={{maxWidth: '200px'}}
      ><option value="">not selected</option>
        {speciesOptions.map((opt, i) => (
          <option key={opt.value} value={opt.value}>
            {i + 1}: {opt.value} (total {countMode}: {opt.count})
          </option>
        ))}</select>
      :
      <label style={{fontWeight: 630}}>
        {speciesOptions[0]?.value}
        {speciesOptions[0] != null ? ` (${speciesOptions[0].count})` : ""}
      </label>
    }
  </label>

  <label style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
    <Molecule width={16} height={16} aria-hidden />
    Chemical ({chemical_key}):&nbsp;
    {
      chemicalsOptions.length > 1 ?
      <select
        value={currentChemical}
        onChange={e => setCurrentChemical(e.target.value)}
        style={{maxWidth: '200px'}}
      ><option value="">not selected</option>
        {chemicalsOptions.map((opt, i) => (
          <option key={opt.value} value={opt.value}>
            {i + 1}: {opt.value} (total {filterCountMode(countMode, "chemicals", "species")}: {opt.count})
          </option>
        ))}</select>
      :
      <label style={{fontWeight: 630}}>
        {chemicalsOptions[0]?.value}
        {chemicalsOptions[0] != null ? ` (${chemicalsOptions[0].count})` : ""}
      </label>
    }
  </label>

  </div>
}

function ResultTableWrapper({ rows, meta }: {rows: Array<DataRows>, meta: Array<DataMeta>}) {
  if (rows.length === 0) {
    return <></>
  }

  const refColumns = meta
    .filter((m) => m.type === "reference")
    .map((m) => m.name)

  let speciesValues: string[] = []
  let used_species = new Set<string>()
  let chemicalValues: string[] = []
  let used_chemicals = new Set<string>()

  rows.forEach((val) => {
    let specie = val.specie_val
    if (!used_species.has(specie)) {
      speciesValues.push(specie)
      used_species.add(specie)
    }

    let chemical = val.chemical_val
    if (!used_chemicals.has(chemical)) {
      chemicalValues.push(chemical)
      used_chemicals.add(chemical)
    }
  })

  const [countMode, setCountMode] = useState<CountMode>("chemicals")

  const speciesOptions: SelectOption[] = speciesValues
    .map((value) => ({
      value,
      count: countLabelForSpecie(rows, value, countMode, refColumns),
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  const chemicalsOptions: SelectOption[] = chemicalValues
    .map((value) => ({
      value,
      count: countLabelForChemical(rows, value, countMode, refColumns),
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  const [currentSpecie, setCurrentSpecie] = useState(speciesOptions.length === 1 ? speciesOptions[0].value : "")
  const [currentChemical, setCurrentChemical] = useState(chemicalsOptions.length === 1 ? chemicalsOptions[0].value : "")

  return <>
  <TableStateBar
    {...{
      rows: rows,
      meta: meta,
      currentSpecie: currentSpecie, setCurrentSpecie: setCurrentSpecie, speciesOptions: speciesOptions,
      currentChemical: currentChemical, setCurrentChemical: setCurrentChemical, chemicalsOptions: chemicalsOptions,
      countMode, setCountMode,
    }}
    />

  <GroupedResultTable {...{rows: rows, meta: meta, currentSpecie: currentSpecie, currentChemical: currentChemical}}/>
  </>
}


function ResultTableOrNull(response: {[index: string]: any}) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let data_meta: Array<DataMeta> = []
  let data = new Map<string, DataRows>()
  let group_chem_inds = new Set<number>()
  let chem_key_column = ""
  let group_specie_inds = new Set<number>()
  let specie_key_column = ""

  let metadata = response["metadata"].sort(
    (
      meta_1: {[index: string]: any},
      meta_2: {[index: string]: any},
    ) => {
      if (meta_1["type"] > meta_2["type"]) {
        return 1
      }
      return -1
    }
  )
  metadata.forEach((meta_item: {[index: string]: any}) => {

    let data_name = meta_item["column"]
    let data_type = ""
    let additional_data = ""

    let full_type = meta_item["type"]
    if (full_type.includes("link")) {
      data_type = "link"
      additional_data = full_type.split("link[")[1].split("]")[0]
    } else if (full_type.includes("clas")) {
      data_type = "clas"
    } else if (full_type.includes("SMILES")) {
      data_type = "smiles"
    } else if (full_type.includes("ref[]")) {
      data_type = "reference"
    }

    if (full_type.includes("chemical")) {
      group_chem_inds.add(data_meta.length)
      if (full_type.includes("keycolumn")) {
        chem_key_column = data_name
      }
    } else if (full_type.includes("specie")) {
      group_specie_inds.add(data_meta.length)
      if (full_type.includes("keycolumn")) {
        specie_key_column = data_name
      }
    }

    let group_type = ""
    if (full_type.includes("chemical")) {
      group_type = "chemical"
    } else if (full_type.includes("specie")) {
      group_type = "specie"
    }
    if (!full_type.includes("table_")) {
      group_type = "ignore"
    }
    data_meta.push(new DataMeta(data_type, data_name, meta_item["name"], meta_item["description"], additional_data, group_type))
  })

  response["data"].forEach((data_item: {[index: string]: any}) => {
    let row = new Map<string, string>()
    let group_chem_row = new Map<string, string>()
    let group_specie_row = new Map<string, string>()

    data_meta.forEach((meta_item: DataMeta, ind) => {
      let item = data_item[meta_item.name] ? data_item[meta_item.name] : ""
      if (group_chem_inds.has(ind)) {
        group_chem_row.set(meta_item.name, item)
      } else if (group_specie_inds.has(ind)) {
        group_specie_row.set(meta_item.name, item)
      } else {
        row.set(meta_item.name, item)
      }
    })

    let chem_key: string[] = []
    group_chem_row.forEach((val) => {chem_key.push(val)})
    let chem_key_str = chem_key.sort().join("")

    let specie_key: string[] = []
    group_specie_row.forEach((val) => {specie_key.push(val)})
    let specie_key_str = specie_key.sort().join("")

    let key = chem_key_str + specie_key_str

    if (!data.has(key)) {
      data.set(key, new DataRows(group_specie_row, specie_key_column, group_chem_row, chem_key_column, []))
    }
    data.get(key)?.add_row(row)
  })

  let rows: Array<DataRows> = []
  data.forEach((val, _) => {
    rows.push(val)
  })

  return <ResultTableWrapper {...{rows: rows, meta: data_meta}}/>
}


export default ResultTableOrNull;