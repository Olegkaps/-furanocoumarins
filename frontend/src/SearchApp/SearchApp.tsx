import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Magnifier, Molecule, BranchesRight } from "@gravity-ui/icons";
import { api } from "../shared/api";
import { cachedGet } from "../shared/apiCache";
import { guardMetadataCatalog } from "../shared/schemaGuard";
import { useNavigate } from "react-router-dom";
import Autocomplete from "./Autocomplete";
import FullNavigation from "../FullNavigation/FullNavigation";
import { InfoTip } from "../shared/ui/InfoTip";
import { PageTour } from "../shared/tour/PageTour";

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
  style: React.CSSProperties;
  dataTour?: string;
}

function AutocompletedInput({
  fetchAutocomplete,
  onChange,
  style,
  dataTour,
}: AutocompletesInputProps) {
  const [_, setSelectedValue] = useState("");

  return (
    <div className="app-container" data-tour={dataTour}>
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
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({
    specie: false,
    chemical: false,
  });
  const navigate = useNavigate();

  const fetchMetadata = async () => {
    const response = await cachedGet("/metadata").catch(
      (err) => err.response,
    );
    const meta = response?.data?.["metadata"] ?? [];
    setMetadata(meta);
    if (response?.status === 200) {
      guardMetadataCatalog(meta, response.data);
    }

    if (response?.status >= 400) {
      alert("Error request");
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  useEffect(() => {
    const onTour = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        action?: string;
        prepare?: string;
      };
      if (detail?.prepare !== "search-open-species") return;
      if (detail.action === "enter") {
        setOpenSection((prev) => ({ ...prev, specie: true }));
      }
    };
    window.addEventListener("fuco-tour", onTour);
    return () => window.removeEventListener("fuco-tour", onTour);
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

  const firstSpecieField = parsed_metadata.find((m) =>
    String(m["type"]).includes("specie"),
  );
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
  <PageTour tourId="search" />
  <form onSubmit={handleSearchRequest} className="search-form" data-tour="search-form">
    <h2>Search</h2>
    {([["Species", "specie", BranchesRight], ["Chemicals", "chemical", Molecule]] as const).map(([name, type, SectionIcon], ind) => {
      const isOpen = openSection[type];
      return (
      <div
        key={type}
        style={{ marginBottom: '12px' }}
        data-tour={type === "specie" ? "search-section-species" : "search-section-chemicals"}
      >
        <button
          type="button"
          onClick={() =>
            setOpenSection((prev) => ({ ...prev, [type]: !prev[type] }))
          }
          aria-expanded={isOpen}
          className="section-toggle"
        >
          <span style={{ display: 'flex', color: 'var(--color-muted)', flexShrink: 0 }} aria-hidden>
            {isOpen ? <ChevronDown /> : <ChevronRight />}
          </span>
          <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <SectionIcon width={22} height={22} aria-hidden />
            {name}
          </h2>
        </button>
        {isOpen && (
      <ul>
        {parsed_metadata.map((curr_meta, fieldInd) => {
          if (!curr_meta["type"].includes(type)) {
            return null
          }

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

          return <li key={curr_meta["column"] ?? fieldInd} style={{width: '400px', position: 'relative'}}>
            <label>
            <InfoTip
              text={curr_meta["description"] ?? ""}
              dataTour={
                curr_meta === firstSpecieField ? "search-info-tip" : undefined
              }
            />
            &nbsp;{curr_meta["name"]}:
            {fieldInd > 0 && <span style={{position: 'absolute', left: '90%', color: 'var(--color-muted)', fontWeight: 600}}>AND</span>}
            <br></br>
            <AutocompletedInput
              fetchAutocomplete={_fetch}
              onChange={(value) => {search_values.set(curr_meta, value.trim())}}
              dataTour={
                curr_meta === firstSpecieField
                  ? "search-autocomplete"
                  : undefined
              }
              style={{
                position: 'relative',
                left: '20%',
                width: '300px',
                height: '30px',
                borderColor: 'var(--color-border)'
              }}
            />
            <hr style={{border: 0, margin: 0, height: '15px'}}></hr>
          </label></li>
      })}</ul>
        )}
        {ind < 1 && <hr style={{border: '1px solid var(--color-border)'}}></hr>}
      </div>
    )})}
    <button
      type='submit'
      className="btn btn-primary"
      data-tour="search-submit"
      style={{ display: 'block', margin: '16px auto 0' }}
    >
      Search&nbsp;<Magnifier />
    </button>
  </form></>
}


export default SearchApp;
export { AppResultTable } from "./ResultTablePage";
export { AppPhilogeneticTree } from "./TreePage";
