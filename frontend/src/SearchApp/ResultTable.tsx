import { isEmpty, ZoomableContainer } from "../Admin/utils";
import config from "../config";
import DataMeta from "./DataMeta";


function ResultTableHead({meta}: {meta: Array<DataMeta>}) {
  return <thead>
    <tr key={"meta"}>
      { meta.map((curr_meta, ind) => (
        <th scope='col' key={"meta" + ind}>
          <p style={{fontSize: config["FONT_SIZE"],}}>{curr_meta.name}</p>
        </th>
      ))}
    </tr>
  </thead>
}


function ResultTableBody({ rows, meta }: {rows: Array<Array<string>>, meta: Array<DataMeta>}) {
  return <tbody>
    { rows.map((row, row_ind) => (
      <tr key={"row_" + row_ind}>
        { row.map((value, ind) => (
          <td key={"item_" + row_ind + "_" + ind}>
            {meta[ind].render(value)}
          </td>
        ))}
      </tr>
    ))}
  </tbody>

}


function ResultTable({ rows, meta }: {rows: Array<Array<string>>, meta: Array<DataMeta>}) {
  if (meta.length === 0) {
    return <div></div>
  }

  return <ZoomableContainer><div className='table'>
    <table style={{margin: 'auto'}}>
      <ResultTableHead {...{meta: meta}} />
      <ResultTableBody {...{meta: meta, rows: rows}} />
      {rows.length === 0 &&
        <caption style={{padding: '20%', border: '1px solid #d4d4d4ff', fontSize: config["FONT_SIZE"], backgroundColor: 'white'}}>No data for given request</caption>
      }
    </table>
  </div></ZoomableContainer>
}


function ResultTableOrNull(response: {[index: string]: any}) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let data_meta: Array<DataMeta> = []
  let data: Array<Array<string>> = []

  response["metadata"].forEach((meta_item: {[index: string]: any}) => {
    if (meta_item["type"].includes("invisible")) {
        return
    }

    let data_name = meta_item["column"]
    let data_type = "clas"  // TO DO: parse type
    let additional_data = ""

    data_meta.push(new DataMeta(data_type, data_name, additional_data))
  })

  response["data"].forEach((data_item: {[index: string]: any}) => {
    let row: Array<string> = []
    data_meta.forEach((meta_item: DataMeta) => {
      row.push(data_item[meta_item.name] ? data_item[meta_item.name] : "")
    })
    data.push(row)
  })

  return <ResultTable {...{rows: data, meta: data_meta}}/>
}


export default ResultTableOrNull;