import { useState } from 'react';

import {ChevronRight} from '@gravity-ui/icons';
import config from '../config';
import DataMeta from './DataMeta';
import { api } from '../Admin/utils';
import PhilogeneticTreeOrNull from './PhilogeneticTree';


function isEmpty(obj: object) {
  return Object.keys(obj).length === 0;
}


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

  return <div className='table'>
    <table style={{margin: 'auto'}}>
      <ResultTableHead {...{meta: meta}} />
      <ResultTableBody {...{meta: meta, rows: rows}} />
      {rows.length === 0 &&
        <caption style={{padding: '20%', border: '1px solid #d4d4d4ff', fontSize: config["FONT_SIZE"], backgroundColor: 'white'}}>No data for given request</caption>
      }
    </table>
  </div>
}


const fetchSEarchResult = async (e: React.FormEvent, seqrch_req: string, setSearchResponse: React.Dispatch<React.SetStateAction<{}>>) => {
  e.preventDefault();
  var bodyFormData = new FormData();

  bodyFormData.append("search_request", seqrch_req)
  var response = await api.post('/search', bodyFormData).catch((err) => {return err.response});

  if (response && response.status === 200) {
    setSearchResponse(response.data)
  } else {
    // TO DO: better error handling
    alert("Error: " + response.status + " - " + response.data.error)
  }
}

function SearchLine({setSearchResponse}: {setSearchResponse: React.Dispatch<React.SetStateAction<{}>>}) {
  const [request, setRequest] = useState("")
  return <div className="card">
      <form className="main_form" onSubmit={(e) => fetchSEarchResult(e, request, setSearchResponse)}>
        <input type="text" className="search-teaxtarea" onChange={(text) => setRequest(text.target.value)} style={{fontSize: 'large'}}></input>
        <div className="search-submit">
          <div style={{
            position: "relative",
            right: "-30%",
            top: "10%"
          }}>
            <div style={{
              position: "absolute",
            }}>
              <ChevronRight />
            </div>
          </div>
          <div style={{
              width: "100%",
              height: "100%",
              position: "relative",
          }}>
            <input type="submit" value="" 
            style={{
              width: "100%",
              height: "100%",
              position: "absolute",
              opacity: 0,
            }} />
          </div>
        </div>
      </form>
    </div>
}


function SearchApp() {
  const [searchResponse, setSearchResponse] = useState<{[index: string]:any}>({})
  let classification_tag = "default" // TO DO: swithcher

  return <>
    <br></br>
    <SearchLine {...{setSearchResponse: setSearchResponse}} />
    <b></b> {/* this doent works */}
    <PhilogeneticTreeOrNull {...{response: searchResponse, tag: classification_tag}} />
    <br></br>
    <ResultTableOrNull {...searchResponse} />
  </>
}


function ResultTableOrNull(response: {[index: string]: any}) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let data = [
    ["ID1", "Plant sp.", "c=c"],
    ["ID2", "Plant sp.", "cc"],
    ["ID3", "Plant sp.", "c"],
    ["ID4", "Plant sp.", "c=cc"],
  ]
  let data_meta = [
    new DataMeta("link", "link", "http://doenotexists.ru"),
    new DataMeta("cls", "specie", ""),
    new DataMeta("smiles", "SMILES", ""),
  ]

  // if (!isEmpty(response)) { // debug
  //   data = response["data"] // parse
  // }
  let _response = {
    "metadata": [
    {
      "column": "domain",
      "type": "clas[0]",
      "description": "Genus (according to original article)"
    },
    {
      "column": "reidn",
      "type": "clas[1]",
      "description": "Subtribe"
    },
    {
      "column": "tribe",
      "type": "clas[2]",
      "description": "tribe"
    },
    {
      "column": "comment_pimenov",
      "type": "clas[0][pimenov]",
      "description": "Species (according to Pimenov)"
    },
    {
      "column": "species_accepted_author",
      "type": "",
      "description": "Author of accepted species according to POWO"
    },
    {
      "column": "genome",
      "type": "link[%s]",
      "description": "NCBI, whole genomic data"
    },
    {
      "column": "number_substituents",
      "type": "invisible",
      "description": "Number of substituents in coumarin nucleus"
    },
    {
      "column": "lsid_original",
      "type": "primary link[https://www.ipni.org/n/%s]",
      "description": "IPNI or POWO Life Sciences Identifier (according to original article)"
    },
    {
      "column": "smiles",
      "type": "SMILES",
      "description": "SMILES-code"
    },
    {
      "column": "type_structure",
      "type": "set invisible",
      "description": "Type of structure"
    },
  ],
  "data": [
    {
      "domain": "E",
      "reidn": "Tordyliinae",
      "tribe": "Tordylieae",
    },
    {
      "domain": "E",
      "reidn": "Tordyliinae",
      "tribe": "Tordylieae",
    },
    {
      "domain": "E",
      "reidn": "Tordyliinae",
      "tribe": "Tordylieae",
    },
    {
      "domain": "E",
      "reidn": "Tordyliinae",
      "tribe": "Abc",
    },
    {
      "domain": "----",
      "reidn": "!-",
      "tribe": "abc",
    },
    {
      "domain": "----",
      "reidn": "!-",
      "tribe": "abc",
    },
  ]
  }


  return <ResultTable {...{rows: data, meta: data_meta}}/>
}

export default SearchApp
