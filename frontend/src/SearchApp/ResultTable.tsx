import { isEmpty, ScrollableContainer } from "../Admin/utils";
import config from "../config";
import DataMeta from "./DataMeta";


function ResultTableHead({meta}: {meta: Array<DataMeta>}) {
  return <thead style={{position: 'sticky', top: 0,}}>
    <tr key={"meta"}>
      { meta.map((curr_meta, ind) => (
        <th scope='col' key={"meta" + ind} style={{backgroundColor: "#ccd8b7ff", padding: 0}}>
          <hr style={{width: '100%', margin: 0, position: 'relative', top: 0}}></hr>
          <p style={{fontSize: config["FONT_SIZE"], margin: '20px 0'}} title={curr_meta.description}>{curr_meta.name}</p>
          <hr style={{width: '100%', margin: 0, position: 'relative', bottom: 0}}></hr>
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
          <td key={"item_" + row_ind + "_" + ind} style={{minWidth: '120px', maxWidth: '200px'}}>
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

  return <ScrollableContainer><div className='table'>
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
  </div></ScrollableContainer>
}


function ResultTableOrNull(response: {[index: string]: any}) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let data_meta: Array<DataMeta> = []
  let data: Array<Array<string>> = []

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
    }

    data_meta.push(new DataMeta(data_type, data_name, meta_item["description"], additional_data))
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