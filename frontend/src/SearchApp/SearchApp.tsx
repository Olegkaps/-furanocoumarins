import { useState } from 'react';

import {ChevronRight} from '@gravity-ui/icons';
import { api } from '../Admin/utils';
import PhilogeneticTreeOrNull from './PhilogeneticTree';
import ResultTableOrNull from './ResultTable';



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


export default SearchApp
