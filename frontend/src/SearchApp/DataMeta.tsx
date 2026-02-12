import { useEffect, useState, type FC, type JSX } from "react";
import config from "../config"
import {ArrowUpRightFromSquare, Check} from '@gravity-ui/icons';
import { api } from "../Admin/utils";
import { useParams } from "react-router-dom";

let ignore_link_prefixes = ["fuco", "NoIPNI", "NoKew"]


class Link{
  id: string
  text: string

  constructor(id: string, text: string) {
    this.id = id
    this.text = text
  }
}

class DataMeta {
  type: string
  name: string
  show_name: string
  description: string
  additional_data: string
  is_ignore: boolean
  is_grouping: boolean
  is_chemical: boolean
  is_specie: boolean

  constructor(type: string, name: string, show_name: string, description: string, data: string, group_type: string) {
    // TO DO: validate type
    this.type = type
    this.name = name
    this.show_name = show_name
    this.description = description
    this.additional_data = data
    this.is_ignore = group_type == "ignore"
    this.is_chemical = group_type == "chemical"
    this.is_specie = group_type == "specie"
    this.is_grouping = this.is_chemical || this.is_specie
  }

  render(value: string | undefined) { // rewrite to classes
    if (value === undefined) {
      value = ""
    }
    if (this.type == "") {
      return this.render_default(value)
    } else if (this.type === "link") {
      return this.render_link(value)
    } else if (this.type === "clas") {
      return this.render_cls(value)
    } else if (this.type === "smiles") {
      return this.render_smiles(value)
    } else if (this.type === "reference") {
      return this.render_reference(value)
    } else {
      return <>
        <p>Not Found</p>{/* // TO FIX */}
      </>
    }
  }

  render_default(value: string, max_length: number = 30, extra_item: React.ReactNode = <></>) {
    let text_value = value
    if (value.length > max_length) {
      text_value = value.slice(0, max_length) + "..."
    }

    return <p 
      style={{fontSize: config["FONT_SIZE"], textAlign: 'center', wordBreak: 'break-all'}}
      title={value}
    >{text_value}{extra_item}</p>
  }

  render_link(value: string) {
    if (value.replaceAll(" ", "") === "") {
      return <></>
    }

    for(const pref of ignore_link_prefixes) {
      if (value.startsWith(pref)) {
        return this.render_default(value, 70)
      }
    }

    let links: Array<Link> = []
    value.split(", ").forEach((val: string) => {
      let text_val = val

      if (val.includes(": ")) {
        let splitted_arr = val.split(": ")
        text_val = splitted_arr[0]
        val = splitted_arr[1]
      }

      links.push(new Link(val, text_val))
    })

    return <>
      {links.map((link, _) => (
      <a href={this.additional_data.replace("%s", link.id)} target="_blank">
        {this.render_default(link.text, 70, <>&nbsp;<ArrowUpRightFromSquare /></>)}
      </a>
    ))}
    </>
  }

  render_cls(value: string) {
    return this.render_default(value) // TO DO
  }

  render_smiles(value: string) {
    return <canvas id={value} className="smiles">{value}</canvas>
  }

  render_reference(value: string) {
    return <a target="_blank" href={"/reference/" + value}>{this.render_default(value)}</a>
  }
}


export default DataMeta;


interface BibtexEntry {
  author?: string;
  title?: string;
  journal?: string;
  year?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
}

const parseBibtex = (bibtexStr: string): BibtexEntry | null => {
  const entry: BibtexEntry = {};
  const lines = bibtexStr.trim().split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*([a-zA-Z]+)\s*=\s*\{(.+?)\},?\s*$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();

      const cleanedValue = value.replace(/^[\{\}"]|(?:[\}]|")$/g, '').trim();

      entry[key as keyof BibtexEntry] = cleanedValue;
    }
  }

  if (!entry.author || !entry.title) {
    return null;
  }

  return entry;
};


const BibtexCitation: FC<{ bibtex: string }> = ({ bibtex }) => {
  const [citation, setCitation] = useState<JSX.Element | null>(null);

  useEffect(() => {
    const parsed = parseBibtex(bibtex);

    if (!parsed) {
      setCitation(<p className="text-red-500">incorrect BibTeX</p>);
      return;
    }

    const authors = parsed.author
      ?.split(' and ')
      .map((name) => name.trim())
      .join(', ');

    const title = <em>{parsed.title}</em>;

    let journalInfo = '';
    if (parsed.journal) {
      journalInfo += parsed.journal;
      if (parsed.volume) journalInfo += `, ${parsed.volume}`;
      if (parsed.number) journalInfo += `(${parsed.number})`;
      if (parsed.pages) journalInfo += `: ${parsed.pages}`;
    }

    const year = parsed.year ? `(${parsed.year})` : '';

    const doiLink = parsed.doi ? (
      <a
        href={`https://doi.org/${parsed.doi}`}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline"
      >
        DOI: {parsed.doi}
      </a>
    ) : null;

    const urlLink = parsed.url ? (
      <a
        href={parsed.url}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline"
      >
        link<ArrowUpRightFromSquare />
      </a>
    ) : null;

    setCitation(
      <div className="bibtex-citation space-y-1">
        <div>
          <strong>{authors}.</strong>{' '}
          {title}.{' '}
          {journalInfo && `${journalInfo}.`}{' '}
          {year}
        </div>
        {doiLink && <div className="text-sm">{doiLink}</div>}
        {urlLink && <div className="text-sm">{urlLink}</div>}
      </div>
    );
  }, [bibtex]);

  return citation;
};


export function Reference() {
  const {article_id} = useParams()
  const [isClicked, setIsClicked] = useState(false)

  const [referenceData, setReferenceData] = useState("")
  if (referenceData === "") {
    api.get("/article/" + article_id).catch(
      (err) => {return err.response}
    ).then(
      (res) => setReferenceData(res["data"]["val"])
    )
  }

  return <div>
    <BibtexCitation bibtex={referenceData} />
    {referenceData !== "" &&
      <button
        style={!isClicked ?
          {border: '1px solid grey', borderRadius: '15px', padding: '10px'} :
          {border: '1px solid grey', borderRadius: '15px', padding: '10px', backgroundColor: 'lightgreen'}
        }
        onClick={
          async () => {
            await navigator.clipboard.writeText(referenceData);
            setIsClicked(true)
            setTimeout(() => {setIsClicked(false)}, 1500)
          }}
        type="button">
          &nbsp;&nbsp;&nbsp;Copy raw BibTeX {isClicked ? <Check /> : <>&nbsp;&nbsp;&nbsp;</>}
      </button>
    }
  </div>
};
