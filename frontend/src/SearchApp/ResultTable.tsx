import { useState } from "react";
import { isEmpty, ScrollableContainer } from "../Admin/utils";
import config from "../config";
import DataMeta from "./DataMeta";
import DataRows from "./RowsData";
import {FileArrowUp} from '@gravity-ui/icons';


const maxPageSize = 100

function ResultTableHead({meta}: {meta: Array<DataMeta>}) {
  return <thead style={{position: 'sticky', top: 0,}}>
    <tr>
      { meta.map((curr_meta) => {
        if (curr_meta.is_grouping) {
          return <></>
        }
        return <th scope='col' style={{backgroundColor: "#ccd8b7ff", padding: 0}}>
          <hr style={{width: '100%', margin: 0, position: 'relative', top: 0}}></hr>
          <p style={{fontSize: config["FONT_SIZE"], margin: '20px 0'}} title={curr_meta.description}>{curr_meta.name}</p>
          <hr style={{width: '100%', margin: 0, position: 'relative', bottom: 0}}></hr>
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
          if (meta_val.is_grouping) {
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
  { rows, meta, countsPrefSum, currentPage }: 
  {
    rows: Array<DataRows>, 
    meta: Array<DataMeta>,
    countsPrefSum: number[],
    currentPage: number,
  }
) {  
  let lowerBound = (currentPage-1)*maxPageSize
  let upperBound = currentPage*maxPageSize

  return <>{rows.map((dataRows, ind) => {
      if (countsPrefSum[ind+1] < lowerBound || countsPrefSum[ind] > upperBound) {
        return <></>
      }

      let from = (
        countsPrefSum[ind] >= lowerBound
        ? 0
        : countsPrefSum[ind+1] - lowerBound
      )
      let to = (
        from + maxPageSize > dataRows.value_rows.length
        ? undefined
        : from + maxPageSize
      )
      let rowsOnPage = dataRows.value_rows.slice(from, to)

      return <>
      <br></br>
      {dataRows.key_row.size > 0 &&
      <div style={{display: 'flex'}}>
        { meta.map((meta_val, ind) => {
            if (meta_val.type !== "smiles") {
              return
            }
            return meta[ind].render(dataRows.key_row.get(meta_val.name))
        })}
        <table><tbody>
          <tr style={{backgroundColor: 'lightgreen'}}><td>total rows</td><td><b>{dataRows.value_rows.length}</b></td></tr>
          { meta.map((meta_val, ind) => {
            if (!meta_val.is_grouping || meta_val.type === "smiles") {
              return
            }
            return <tr>
              <td title={meta_val.description}>{meta_val.name}</td>
              <td>{meta[ind].render(dataRows.key_row.get(meta_val.name))}</td>
            </tr>
        })}</tbody></table>
      </div>
      }

      <br></br>
      <ScrollableContainer>
        <ResultTable {...{rows: rowsOnPage, meta: meta}}/>
      </ScrollableContainer>
      </>
    })}</>
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
        if (curr_meta.is_grouping) {
          value = dataRows.key_row.get(curr_meta.name)
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
  { rows, meta, currentPage, numPages, setCurrentPage, }: 
  {
    rows: DataRows[],
    meta: DataMeta[],
    currentPage: number,
    numPages: number,
    setCurrentPage: React.Dispatch<React.SetStateAction<number>>,
  }
) {
  return <div 
    style={{
      marginLeft: '25px',
      marginRight: '25px',
      border: '1px dashed grey',
      borderRadius: '5px',
      padding: '4px',
      paddingLeft: '20px',
    }}>

  <label>Page number:&nbsp;&nbsp;
    <select
      value={currentPage}
      onChange={e => setCurrentPage(Number(e.target.value))}
    >{Array(numPages).fill(null).map((_, i) => <option value={i+1}>{i+1}</option>)}</select>
  </label>

  <label>&nbsp;&nbsp;&nbsp;&nbsp;</label>
  <label>Download results:&nbsp;&nbsp;
    <button
      onClick={() => loadDataRowsAsCSV(rows, meta)}
      style={{border: 0, backgroundColor: "#dbd8ff", borderRadius: '15%'}} >
        <FileArrowUp {...{style: {width: '25px', height: '25px', alignSelf: 'center', color: '#41b9ff'}}}/>
      </button>
  </label>
  </div>
}

function ResultTableWrapper({ rows, meta }: {rows: Array<DataRows>, meta: Array<DataMeta>}) {
  let [currentPage, setCurrentPage] = useState(1)

  let countsPrefSum: number[] = [0]
  rows.forEach((val) => {
    countsPrefSum.push(countsPrefSum.slice(-1)[0] + val.total_length)
  })
  let numPages = Math.ceil(countsPrefSum.slice(-1)[0] / maxPageSize)

  return <>
  <TableStateBar {...{rows: rows, meta: meta, currentPage: currentPage, numPages: numPages, setCurrentPage: setCurrentPage}}/>

  <GroupedResultTable {...{rows: rows, meta: meta, countsPrefSum: countsPrefSum, currentPage: currentPage}}/>
  </>
}


function ResultTableOrNull(response: {[index: string]: any}) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let data_meta: Array<DataMeta> = []
  let data = new Map<string, DataRows>()
  let group_inds = new Set<number>()

  response["metadata"].forEach((meta_item: {[index: string]: any}) => {

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
      group_inds.add(data_meta.length)
    }

    data_meta.push(new DataMeta(data_type, data_name, meta_item["description"], additional_data, full_type.includes("chemical")))
  })

  response["data"].forEach((data_item: {[index: string]: any}) => {
    let row = new Map<string, string>()
    let group_row = new Map<string, string>()

    data_meta.forEach((meta_item: DataMeta, ind) => {
      let item = data_item[meta_item.name] ? data_item[meta_item.name] : ""
      if (group_inds.has(ind)) {
        group_row.set(meta_item.name, item)
      } else {
        row.set(meta_item.name, item)
      }
    })

    let key: string[] = []
    group_row.forEach((val) => {key.push(val)})
    let key_str = key.sort().join("")

    if (!data.has(key_str)) {
      data.set(key_str, new DataRows(group_row, []))
    }
    data.get(key_str)?.add_row(row)
  })

  let rows: Array<DataRows> = []
  data.forEach((val, _) => {
    rows.push(val)
  })

  return <ResultTableWrapper {...{rows: rows, meta: data_meta}}/>
}


export default ResultTableOrNull;