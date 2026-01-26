import { useState } from 'react';

import {ArrowUpRightFromSquare, ChevronRight} from '@gravity-ui/icons';
import { api, isEmpty } from '../Admin/utils';
import PhilogeneticTreeOrNull from './PhilogeneticTree';
import ResultTableOrNull from './ResultTable';
import { Link, Navigate, useSearchParams } from 'react-router-dom';


let isDataFetched = false

const fetchSearchResult = async (e: React.FormEvent | null, seqrch_req: string, setSearchResponse: React.Dispatch<React.SetStateAction<{}>>) => {
  e?.preventDefault();
  var bodyFormData = new FormData();

  bodyFormData.append("search_request", seqrch_req)
  var response = await api.post('/search', bodyFormData).catch((err) => {return err.response});

  if (response && response.status === 200) {
    setSearchResponse(response.data)
    isDataFetched = true
  } else {
    // TO DO: better error handling
    alert("Error: " + response.status + " - " + response.data.error)
  }
}

function SearchLine({setSearchResponse}: {setSearchResponse: React.Dispatch<React.SetStateAction<{}>>}) {  
  const [searchParams, setSearchParams] = useSearchParams();

  let query = searchParams.get("query")
  if (query === null) {
    query = ""
  }
  if (query !== "" && !isDataFetched) {
    fetchSearchResult(null, query, setSearchResponse).then()
  }

  const [request, setRequest] = useState(query)

  return <div className="card">
      <form className="main_form" onSubmit={async (e) => {await fetchSearchResult(e, request, setSearchResponse); setSearchParams({query: request})}}>
        <input type="text" className="search-teaxtarea" onChange={(text) => setRequest(text.target.value)} style={{fontSize: 'large'}} value={request}></input>
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
            <input type="submit" value="" id="search-button"
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


function filterResponse(searchResponse: {[index: string]: any;}) {
  if (isEmpty(searchResponse)) {
    return searchResponse
  }

  let resultResponse: {[index: string]: any} = {}

  resultResponse["metadata"] = []
  searchResponse["metadata"].forEach((meta_item: {[index: string]: any}) => {
    if (!meta_item["type"].includes("invisible")) {
      resultResponse["metadata"].push(meta_item)
    }}
  )

  resultResponse["data"] = []

  let meta_defaults: {[ind: string]: any} = {}
  searchResponse["metadata"].forEach((meta_item: {[index: string]: any}) => {
    // e.g 'clas[00]', 'clas[02][powo]', ...
    let _type = meta_item["type"]    
    if (!_type.startsWith("clas[") || _type.includes("invisible")) {
      return
    }
  
    let curr_num: string = _type.split("[")[1].split("]")[0]
    if (!(curr_num in meta_defaults)) {
      meta_defaults[curr_num] = {"default": "", "custom": []}
    }

    let curr_tag = "default"
    if (_type.includes("][")) {
      curr_tag = _type.split("][")[1].split("]")[0]
    }
  
    if (curr_tag === "default") {
      meta_defaults[curr_num]["default"] = meta_item["column"]
    } else {
      meta_defaults[curr_num]["custom"].push(meta_item["column"])
    }
  })

  searchResponse["metadata"].forEach((meta_item: {[index: string]: any}) => {
    // e.g 'default[lsid_original]', ...
    let _type = meta_item["type"]    
    if (!_type.includes("default[") || _type.includes("invisible")) {
      return
    }

    let default_col = _type.split("default[")[1].split("]")[0]
  
    if (!(default_col in meta_defaults)) {
      meta_defaults[default_col] = {"default": default_col, "custom": []}
    }

    meta_defaults[default_col]["custom"].push(meta_item["column"])
  })
  
  searchResponse["data"].forEach((row: {[index: string]: string}) => {
    Object.values(meta_defaults).forEach((obj: {[index: string]: any}) => {

      let default_col: string = obj["default"]
      obj["custom"].forEach((col: string) => {
        let value = row[col]
        if (value.replaceAll(" ", "") === "") {
          row[col] = row[default_col]
        }
      })
    })

    resultResponse["data"].push(row)
  })

  return resultResponse
}


function EmptyResponse() {
  return <p
    style={{
      width: '100%',
      padding: 'auto',
      textAlign: 'center',
      fontSize: 'larger',
      fontWeight: 600
    }}>No data for given request</p>
}


function SearchLink({path, text} : {path: string, text: string}) {
  const [searchParams, _] = useSearchParams();

  return <Link
    to={{
      pathname: path,
      search: "?query=" + searchParams.get("query")
    }}
    target="_blank"
    style={{
      position: 'absolute',
      top: '15%',
      left: '0.5%',
      padding: '8px',
      backgroundColor: '#dcfbff',
      whiteSpace: 'break-spaces',
      maxWidth: '8%',
      border: '1px solid grey',
      borderRadius: '10px',
    }}
  >{text}<ArrowUpRightFromSquare /></Link>
}

function SearchApp() {
  return <Navigate to="/tree" />
}


export default SearchApp


export function AppResultTable() {
  const [searchResponse, setSearchResponse] = useState<{[index: string]:any}>({})

  let filteredResponse = filterResponse(searchResponse)

  return <>
    <br></br>
    <SearchLine {...{setSearchResponse: setSearchResponse}} />
    <br></br>
    {!isEmpty(searchResponse) && 
      <div>{searchResponse["data"].length === 0 ?
        <EmptyResponse />
        :
        <SearchLink {...{path: "/tree", text: "Philogenetic Tree"}}/>
      }</div>
    }
    <br></br>
    <ResultTableOrNull {...filteredResponse} />
    <br></br>
  </>
}


export function AppPhilogeneticTree() {
  const [searchResponse, setSearchResponse] = useState<{[index: string]:any}>({})
  let [classificationTag, setClassificationTag] = useState("default")

  let filteredResponse = filterResponse(searchResponse)

  return <>
    <br></br>
    <SearchLine {...{setSearchResponse: setSearchResponse}} />
    <br></br>
    {!isEmpty(searchResponse) && 
      <div>
      {searchResponse["data"].length === 0 ?
        <EmptyResponse />
        :
        <SearchLink {...{path: "/table", text: "Result Table"}}/>
      }</div>
    }
    <br></br>
    <PhilogeneticTreeOrNull {...{response: filteredResponse, tag: classificationTag, setTag: setClassificationTag}} />
    <br></br>
  </>
}
