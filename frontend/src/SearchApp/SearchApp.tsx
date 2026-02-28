import { useEffect, useState } from "react";
import { ChevronRight, CircleInfo } from "@gravity-ui/icons";
import { api } from "../shared/api";
import { useNavigate } from "react-router-dom";
import Autocomplete from "./Autocomplete";
import FullNavigation from "../FullNavigation/FullNavigation";

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

  return <>
  <FullNavigation pageName="home" />
  <form onSubmit={handleSearchRequest}
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
  </form></>
}


export default SearchApp;
export { AppResultTable } from "./ResultTablePage";
export { AppPhilogeneticTree } from "./TreePage";
