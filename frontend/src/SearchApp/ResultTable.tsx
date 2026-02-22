import { useState } from "react";
import { Container, isEmpty, ScrollableContainer } from "../Admin/utils";
import config from "../config";
import DataMeta from "./DataMeta";
import DataRows from "./RowsData";
import {FileArrowUp, CircleInfo} from '@gravity-ui/icons';


function ResultTableHead({meta}: {meta: Array<DataMeta>}) {
  return <thead style={{position: 'sticky', top: 0, zIndex: 900}}>
    <tr>
      { meta.map((curr_meta) => {
        if (curr_meta.is_grouping || curr_meta.is_ignore) {
          return <></>
        }
        return <th scope='col' style={{backgroundColor: "#ccd8b7ff", padding: 0}}>
          <p style={{fontSize: config["FONT_SIZE"], margin: '20px 0'}} title={curr_meta.description}>{curr_meta.show_name}&nbsp;<CircleInfo /></p>
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
          return <td style={{minWidth: '120px', maxWidth: '200px'}}>
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
    return <p style={{
      width: '100%',
      padding: 'auto',
      textAlign: 'center',
      fontSize: 'larger',
      fontWeight: 600
    }}>Select species or chemical</p>
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

  return <>{filteredRows.map((dataRows, row_ind) => (
    <div style={{maxHeight: '600px'}}>
      <br></br>
      {dataRows.chemical_row.size * dataRows.specie_row.size > 0 ?
      <div>
      <div style={{display: 'flex'}}>
        <Container maxHeight="500px"><table>
          <p style={{textAlign: 'center', color: 'red'}}>Chemical</p>
          <tbody>
          { meta.map((meta_val, ind) => {
            if (!meta_val.is_chemical || meta_val.type === "smiles") {
              return
            }
            return <tr>
              <td title={meta_val.description} style={{maxWidth: '180px'}}><CircleInfo />&nbsp;{meta_val.show_name}</td>
              <td style={{maxWidth: '130px'}}>{meta[ind].render(dataRows.chemical_row.get(meta_val.name))}</td>
            </tr>
        })}</tbody></table></Container>

        <table>
        <tr><Container>{ meta.map((meta_val, ind) => {
            if (meta_val.type !== "smiles") {
              return
            }
            return meta[ind].render(dataRows.chemical_row.get(meta_val.name))
        })}</Container></tr>

        <tr style={{maxWidth: '300px'}}>
          <ScrollableContainer maxHeight="250px">
            <ResultTable {...{rows: dataRows.value_rows, meta: meta}}/>
          </ScrollableContainer>
        </tr>
        </table>

      <Container maxHeight="500px"><table>
        <p style={{textAlign: 'center', color: 'blue'}}>Species</p>
        <tbody>
        { meta.map((meta_val, ind) => {
          if (!meta_val.is_specie) {
            return
          }
          return <tr>
            <td title={meta_val.description} style={{maxWidth: '180px'}}><CircleInfo />&nbsp;{meta_val.show_name}</td>
            <td style={{maxWidth: '130px'}}>{meta[ind].render(dataRows.specie_row.get(meta_val.name))}</td>
          </tr>
      })}</tbody></table></Container>

      </div>
      </div>

      :

      <ScrollableContainer>
        <ResultTable {...{rows: dataRows.value_rows, meta: meta}}/>
      </ScrollableContainer>

      }
        {row_ind < filteredRows.length &&
          <>
            <br></br>
            <hr style={{border: '1px dashed black'}}></hr>
            <br></br>
          </>
        }
      </div>
    ))}</>
}


function loadDataRowsAsCSV(rows: Array<DataRows>, meta: Array<DataMeta>) {
  let csvContent = "data:text/csv;charset=utf-8,";
  
  let parsedRow: string[] = []
  meta.forEach((curr_meta) => {parsedRow.push(curr_meta.name)})

  let joinedRow = parsedRow.join(",");
  csvContent += joinedRow + "\r\n";

  rows.forEach((dataRows) => {
    dataRows.value_rows.forEach((currRow) => {
      parsedRow = []

      meta.forEach((curr_meta) => {
        let value
        if (curr_meta.is_chemical) {
          value = dataRows.chemical_row.get(curr_meta.name)
        } else if (curr_meta.is_specie) {
          value = dataRows.specie_row.get(curr_meta.name)
        } else {
          value = currRow.get(curr_meta.name)
        }

        parsedRow.push(value === undefined ? "" : value)
      })

      joinedRow = parsedRow.join(",");
      csvContent += joinedRow + "\r\n";
    })
  });

  var encodedUri = encodeURI(csvContent);
  window.open(encodedUri);
}

function TableStateBar(
  { rows, meta, currentSpecie, setCurrentSpecie, species, currentChemical, setCurrentChemical, chemicals }: 
  {
    rows: DataRows[],
    meta: DataMeta[],
    currentSpecie: string,
    setCurrentSpecie: React.Dispatch<React.SetStateAction<string>>,
    species: string[],
    currentChemical: string,
    setCurrentChemical: React.Dispatch<React.SetStateAction<string>>,
    chemicals: string[]
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
  return <div 
    style={{
      marginLeft: '25px',
      marginRight: '25px',
      border: '1px dashed grey',
      borderRadius: '5px',
      padding: '4px',
      paddingLeft: '20px',
    }}>

  <label>Specie ({specie_key}):&nbsp;&nbsp;
    {
      species.length > 1 ?
      <select
        value={currentSpecie}
        onChange={e => setCurrentSpecie(e.target.value)}
      ><option value="">not selected</option>
        {species.map((specie, i) => <option value={specie}>{i+1}: {specie}</option>)}</select>
      :
      <label style={{fontWeight: 630}}>{species[0]}</label>
    }
  </label>

  <label>&nbsp;&nbsp;&nbsp;&nbsp;</label>

  <label>Chemical ({chemical_key}):&nbsp;&nbsp;
    {
      chemicals.length > 1 ?
      <select
        value={currentChemical}
        onChange={e => setCurrentChemical(e.target.value)}
      ><option value="">not selected</option>
        {chemicals.map((chemical, i) => <option value={chemical}>{i+1}: {chemical}</option>)}</select>
      :
      <label>{chemicals[0]}</label>
    }
  </label>

  <label>&nbsp;&nbsp;&nbsp;&nbsp;</label>

  <label>Download results:&nbsp;&nbsp;
    <button
      onClick={() => loadDataRowsAsCSV(rows, meta)}
      style={{border: 0, backgroundColor: "#dbd8ff", borderRadius: '15%'}} >
        <FileArrowUp {...{style: {width: '25px', height: '25px', alignSelf: 'center', color: '#41b9ff'}}}/>
      </button>
  </label>

  <label>&nbsp;&nbsp;&nbsp;&nbsp;</label>

  <label style={{color: 'green'}}>Rows in selection:&nbsp;&nbsp;<b>{total_rows}</b>
  </label>

  </div>
}

function ResultTableWrapper({ rows, meta }: {rows: Array<DataRows>, meta: Array<DataMeta>}) {  
  if (rows.length === 0) {
    return <></>
  }

  let [currentSpecie, setCurrentSpecie] = useState("")
  let [currentChemical, setCurrentChemical] = useState("")

  let species: string[] = []
  let used_species = new Set<string>()
  let chemicals: string[] = []
  let used_chemicals = new Set<string>()

  rows.forEach((val) => {
    let specie = val.specie_val
    if (!used_species.has(specie)) {
      species.push(specie)
      used_species.add(specie)
    }

    let chemical = val.chemical_val
    if (!used_chemicals.has(chemical)) {
      chemicals.push(chemical)
      used_chemicals.add(chemical)
    }
  })

  species = species.sort()
  chemicals = chemicals.sort()

  return <>
  <TableStateBar 
    {...{
      rows: rows, meta: meta,
      currentSpecie: currentSpecie, setCurrentSpecie: setCurrentSpecie, species: species,
      currentChemical: currentChemical, setCurrentChemical: setCurrentChemical, chemicals: chemicals,
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