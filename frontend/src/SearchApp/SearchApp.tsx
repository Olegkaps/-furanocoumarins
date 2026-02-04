import { useEffect, useState } from 'react';

import {ArrowUpRightFromSquare, ChevronRight, CircleInfo, House} from '@gravity-ui/icons';
import { api, isEmpty } from '../Admin/utils';
import PhilogeneticTreeOrNull from './PhilogeneticTree';
import ResultTableOrNull from './ResultTable';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Autocomplete from './Autocomplete';


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
        <div style={{
          width: '5%',
          backgroundColor: '#fcdbf4',
          border: '1px solid grey',
          borderRadius: '10%',
        }}>
          <div style={{
            position: "relative",
            right: "-30%",
            top: "10%"
          }}>
            <div style={{
              position: "absolute",
            }}>
              <ChevronRight style={{color: 'grey'}}/>
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
    isDataFetched = false
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

  // DELETE LATER START 1
  let meta_defaults: {[ind: string]: any} = {}
  searchResponse["metadata"].forEach((meta_item: {[index: string]: any}) => {
    // e.g 'clas[00]', 'clas[02][powo]', ...
    let _type = meta_item["type"]    
    if (!_type.startsWith("clas[") || _type.includes("invisible")) {
      return
    }
  
    let curr_num: string = _type.split("clas[")[1].split("]")[0]
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

  // DELETE LATER START 2
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
  // DELETE LATER END 2

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
    // DELETE LATER END 1

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

  return <label style={{
      position: 'absolute',
      top: '15%',
      left: '0.5%',
      padding: '8px',
      backgroundColor: '#ffbe85',
      whiteSpace: 'break-spaces',
      maxWidth: '120px',
      border: '3px solid grey',
      borderRadius: '10px',
    }}><p>Go&nbsp;to:</p>
    <Link to={{
      pathname: path,
      search: "?query=" + searchParams.get("query")
    }}
    target="_blank"
  >{text}<ArrowUpRightFromSquare /></Link></label>
}

function HomeLink() {
  return <Link to={"/"} target='_blank'
    style={{
      position: 'absolute',
      left: '50px',
      top: '21px',
      backgroundColor: '#e1c8ff',
      border: '1px solid grey',
      borderRadius: '10px',
      padding: '10px 10px 5px 10px',
  }}
  ><House width={'30px'} height={'30px'}/></Link>
}


const fetchAutocomplete = (column: string): any => {
  return async (query: string): Promise<string[]> => {
    let data: string[] = [];

    var response = await api.get('/autocomplete/'+column + "?value=" + query).catch((err) => {return err.response});

    if (response && response.status === 200) {
      data = response.data["values"]
    } else {
      alert("Error: " + response.status + " - " + response.data.error)
    }

    return data;
  }
};

interface AutocompletesInputProps {
  fetchAutocomplete: (query: string) => Promise<string[]>;
  onChange: (value: string) => void;
  style: React.CSSProperties
}

function AutocompletedInput({fetchAutocomplete, onChange, style}: AutocompletesInputProps) {
  const [_, setSelectedValue] = useState('');

  return (
    <div className="app-container">      
      <Autocomplete
        fetchSuggestions={fetchAutocomplete}
        onSelect={(value) => setSelectedValue(value)}
        onChange={onChange}
        style={style}
        placeholder="Enter..."
      />
    </div>
  );
}

function SearchApp() {
  let [metadata, setMetadata] = useState<Array<{[index: string]:any}>>([]);
  const navigate = useNavigate();

  const fetchMetadata = async () => {
    const response = await api.get('/metadata').catch((err) => {return err.response});
    setMetadata(response.data["metadata"]);

    if (response?.status >= 400) {
      alert('Error request')
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  if (metadata === undefined || metadata.length === 0) {
    return <p style={{textAlign: 'center'}}>Loading...</p>
  }

  let parsed_metadata: {[index: string]: any;}[] = []
  let search_values = new Map<{[index: string]: any;}, string>()

  metadata.forEach((curr_meta) => {
    if (!curr_meta["type"].includes("search")) {
      return
    }
    parsed_metadata.push(curr_meta)
    search_values.set(curr_meta, "")
  })

  if (parsed_metadata.length === 0) {
    navigate('/table')
  }

  const handleSearchRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    let search_params: string[] = []

    search_values.forEach((val, key) => {
      if (val === "") {
        return
      }
      let op = " = "
      if (key["type"].includes("set")) {
        op = " CONTAINS "
      }
      search_params.push(key["column"] + op + "'" + val + "'")
    })

    if (search_params.length === 0) {
      alert("Enter at least one parameter")
      return
    }

    navigate('/table?query=' + search_params.join(" AND "));
  };

  return <form onSubmit={handleSearchRequest}
    style={{
      border: '1px dashed grey',
      borderRadius: '15px',
      backgroundColor: '#eaf5ff',
      padding: '25px',
      paddingLeft: '40px',
      width: '600px',
      margin: 'auto'
    }}>
    <h2 style={{textAlign: 'center'}}>Search species or substances</h2>
    <ul>{parsed_metadata.map((curr_meta, ind) => {

      let _fetch: (query: string) => Promise<string[]>

      if (curr_meta["type"].includes("set[")) {
        let values = curr_meta["type"].split("set[")[1].split("]")[0].split(" ")

        _fetch = async (query: string): Promise<string[]> => {
          return values.filter((item: string) =>
            item.toLowerCase().includes(query.toLowerCase())
          );
        }
      } else {
        _fetch = fetchAutocomplete(curr_meta["column"])
      }

      return <li style={{width: '400px', position: 'relative'}}><label title={curr_meta["description"]}>
        <CircleInfo />&nbsp;{curr_meta["name"]}:
        {ind > 0 && <span style={{position: 'absolute', left: '90%', color: 'blue'}}>AND</span>}
        <br></br>
        <AutocompletedInput
          fetchAutocomplete={_fetch}
          onChange={(value) => {search_values.set(curr_meta, value.trim())}}
          style={{
            position: 'relative',
            left: '20%',
            width: '300px',
            height: '30px',
            borderColor: 'grey'
          }}
        />
        <hr style={{border: 0, margin: 0, height: '15px'}}></hr>
      </label></li>
    })}</ul>
    <button type='submit' style={{
      position: 'relative',
      left: '45%',
      padding: '8px',
      border: '1px solid grey',
      borderRadius: '7px',
      backgroundColor: '#efeaff',
    }}>Search<ChevronRight style={{color: 'grey'}}/></button>
  </form>
}


export default SearchApp


export function AppResultTable() {
  const [searchResponse, setSearchResponse] = useState<{[index: string]:any}>({})

  let filteredResponse = filterResponse(searchResponse)

  return <>
    <HomeLink />
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
    <HomeLink />
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
