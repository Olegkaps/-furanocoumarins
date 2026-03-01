import { Link, useSearchParams } from "react-router-dom";
import { isEmpty } from "../shared/api";
import { ZoomableContainer } from "../shared/ui";
import config from "../config";
import { ArrowUpRightFromSquare } from "@gravity-ui/icons";


class Specie {
  values_count: number
  clades: Array<string>

  constructor(count: number, clades: Array<string>) {
    this.values_count = count
    this.clades = clades
  }
}


class PhilogeneticTreeNode {
  clade_name: string
  childs: {[key: string]: PhilogeneticTreeNode;}
  childs_num: number
  clades_num: number
  is_visible: boolean

  constructor(clade_name: string) {
    this.clade_name = clade_name
    this.childs = {}
    this.childs_num = 0
    this.clades_num = 0
    this.is_visible = true
  }

  add_child(clades: Array<string>, count: number) {
    let curr_clade = clades[0]
    if (!(curr_clade in this.childs)) {
      this.childs[curr_clade] = new PhilogeneticTreeNode(curr_clade)
    }
    this.clades_num += 1
    this.childs_num += count

    if(clades.length > 1) {
      this.childs[curr_clade].add_child(clades.slice(1), count)
    } else {
      this.childs[curr_clade].clades_num = 1
      this.childs[curr_clade].childs_num = count
    }
  }

  click_visible() {
    this.is_visible = !this.is_visible
  }

  render(meta: Array<string>, meta_names: Array<string>, meta_ind: number = 0, child_ind: number = 0, total_bros: number = 0) {
    return <div
      style={{
        width: '100%',
        backgroundColor: 'white',
        display: 'table',
      }}>

      <div style={{
          display: 'table-cell',
          verticalAlign: 'middle',
          height: 30 * this.clades_num,
          borderColor: 'white',
          minWidth: '220px',
      }}>
        <TreeCladesAdapter {...{
          drawLeftBorder: meta_ind === 0 || child_ind === 0
        }} />
        <TreeCladeLine />
        <div style={{
          position: 'relative',
          top: '-35px',
          right: '-30px',
        }}>
          <p style={{
            position: 'absolute',
            fontSize: config["FONT_SIZE"],
            fontWeight: 600,
          }}
          title={meta_names[meta_ind]}>
            {this.clade_name.replace(' ', '\u00A0')}
          </p>
        </div>
        {!(Object.keys(this.childs).length <= 1 && total_bros === 1) && !(meta_ind === 1 && total_bros === 1)
        && <div style={{
          position: 'relative',
          top: '-15px',
          right: '25px',
        }}>
          <CountButton {...{
            number: this.childs_num,
            clade_key: meta[meta_ind],
            clade_val: this.clade_name
          }} />
        </div>}
        <TreeCladesAdapter {...{
          drawLeftBorder: meta_ind === 0 || child_ind === total_bros - 1
        }} />
      </div>
      <div style={{display: 'table-cell', verticalAlign: 'middle'}}>{ isEmpty(this.childs) || !this.is_visible
        ?
          <div></div>
        :
          <div>{
            Object.keys(this.childs).sort(
              (a, b) => Object.keys(a).length - Object.keys(b).length
            ).map((name, ind) => (
              <div>
                {this.childs[name].render(meta, meta_names, meta_ind+1, ind, Object.keys(this.childs).length)}
              </div>
            ))
          }</div>
      }</div>
    </div>
  }
}


function TreeCladesAdapter({drawLeftBorder}: {drawLeftBorder: boolean}) {
  return <div style={
    drawLeftBorder
    ?
    {height: '50%'}
    :
    {height: '50%', borderLeft: '2px solid black'}
  }>
    &nbsp;
  </div>
}


function TreeCladeLine() {
  return <hr style={{borderColor: 'black', width: '100%', margin: 0}}></hr>
}


function _Button({children}: {children: React.ReactNode}) {
  return <button style={{
    backgroundColor: '#fae6b0',
    padding: '4px 5px 6px 5px',
    border: '0',
    borderRadius: '40%',
    position: 'absolute',
    fontSize: config["FONT_SIZE"],
    fontWeight: 700,
    width: '50px',
  }}>{children}</button>
}

function CountButton(
  {number, clade_key, clade_val}:
  {number: number, clade_key: string, clade_val: string}
) {
  if (clade_key === "__root__" || clade_val.replaceAll(" ", "") === "") {
    return <_Button>{number}</_Button>
  }

  const [searchParams, _] = useSearchParams();
  let query = searchParams.get("query")
  if (query === null) {
    query = ""
  }

  if (!query.includes(clade_key)) {
    query += " AND " + clade_key + " = '" + clade_val + "'"
  }

  return <_Button>
    <Link to={{
      pathname: "/table",
      search: "?query=" + query
    }} style={{fontSize: config["FONT_SIZE"]}}
     target="_blank">
      {number}&nbsp;<ArrowUpRightFromSquare {...{style: {width: '12px', height: '12px'}}}/>
    </Link>
    </_Button>
}


function PhilogeneticTree({ species, meta, meta_names }: {species: Array<Specie>, meta: Array<string>, meta_names: Array<string>}) {
  if (species.length === 0) {
    return <div></div>
  }
  // TO DO: all nested arrays must have same lenght eith meta
  // TO DO: all arrays must be unique
  let root = new PhilogeneticTreeNode("")
  for(let specie of species) {
    root.add_child(specie.clades, specie.values_count)
  }

  // TO DO: Add visibility for branches and clades


  return <ZoomableContainer>{root.render(meta, meta_names)}</ZoomableContainer>
}

export type CountMode = "chemical" | "article" | "all";
function collectUniqueValuesFromRow(row: {[index: string]: string}, columnNames: Array<string>, into: Set<string>) {
  columnNames.forEach((col) => {
    const v = row[col]
    if (v != null && String(v).trim() !== "") {
      String(v).split(/\s*,\s*/).forEach((s) => {
        const t = s.trim()
        if (t) into.add(t)
      })
    }
  })
}

function PhilogeneticTreeOrNull(
    {response, tag, setTag, countMode, setCountMode}:
    {response: {[index: string]: any},
    tag: string,
    setTag: React.Dispatch<React.SetStateAction<string>>,
    countMode: CountMode,
    setCountMode: React.Dispatch<React.SetStateAction<CountMode>>},
  ) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let metadata_response = response["metadata"]
  metadata_response.sort((a: { [x: string]: string; }, b: { [x: string]: string; }) => {
    let t_a = a["type"]
    if (t_a.startsWith("table_")) {
      t_a = t_a.split(" ")[1]
    }

    let t_b = b["type"]
    if (t_b.startsWith("table_")) {
      t_b = t_b.split(" ")[1]
    }

    if (t_a === t_b) {
      return 0
    } else if (t_a < t_b) {
      return 1
    }
    return -1
  })

  let species_meta = ["__root__"]
  let meta_names = ["__root__"]
  let class_num_to_tag: {[val: string]: string} = {}

  let all_tags = new Set<string>()
  all_tags.add("default")
  all_tags.add(tag)

  metadata_response.forEach((meta_item: {[index: string]: any}) => {
    // e.g 'clas[00]', 'clas[02][powo]', ...
    let _type = meta_item["type"]
    if (!_type.includes("clas[")) {
      return
    }

    let curr_num: string = _type.split("clas[")[1].split("]")[0]

    let curr_tag = "default"
    if (_type.includes("][")) {
      curr_tag = _type.split("][")[1].split("]")[0]
    }

    all_tags.add(curr_tag)
    if (curr_tag === "default" && !(curr_num in class_num_to_tag)) {
      //
    } else if (curr_tag === tag && curr_num in class_num_to_tag) {
      species_meta.pop()
    } else if (curr_tag !== tag) {
      return
    }

    let clade_name = meta_item["column"]
    species_meta.push(clade_name)
    meta_names.push(meta_item["name"])
    class_num_to_tag[curr_num] = curr_tag
  })

  const smilesColumns = (response["metadata"] as Array<{[index: string]: string}>)
    .filter((m) => m["type"]?.includes("SMILES"))
    .map((m) => m["column"])
  const refColumns = (response["metadata"] as Array<{[index: string]: string}>)
    .filter((m) => m["type"]?.includes("ref[]"))
    .map((m) => m["column"])

  type UniqueSets = { smiles: Set<string>; refs: Set<string> }
  const uniquesByClades: {[joined_clades: string]: UniqueSets} = {}

  response["data"]?.forEach((row: {[index: string]: string}) => {
    let clades: Array<string> = []
    species_meta.forEach((clade_name: string, ind: number) => {
      if (ind === 0) return
      clades.push(row[clade_name])
    })
    const joined_clades = clades.join("@")
    if (!(joined_clades in uniquesByClades)) {
      uniquesByClades[joined_clades] = { smiles: new Set(), refs: new Set() }
    }
    const u = uniquesByClades[joined_clades]
    collectUniqueValuesFromRow(row, smilesColumns, u.smiles)
    collectUniqueValuesFromRow(row, refColumns, u.refs)
  })

  let counts: {[index: string]: number} = {}
  Object.entries(uniquesByClades).forEach(([joined_clades, u]) => {
    const nSmiles = smilesColumns.length ? u.smiles.size : 1
    const nRefs = refColumns.length ? u.refs.size : 1
    counts[joined_clades] =
      countMode === "chemical"
        ? nSmiles
        : countMode === "article"
          ? nRefs
          : nSmiles * nRefs
  })

  let species = [] as Array<Specie>
  Object.entries(counts).forEach(([joined_clades, count]) => {
    species.push(new Specie(count, joined_clades.split("@")))
  });
  if (species.length <= 1) {
    return <div></div>
  }

  return <div style={{marginTop: '20px'}}>
    <div style={{marginLeft: '25px', marginRight: '25px', border: '1px dashed grey', borderRadius: '5px', padding: '4px', paddingLeft: '20px'}}>
      <span>
        Taxonomy according to NCBI is given starting with subtribes.
        Taxonomy of genus and species is given according to original articles,
        POWO site and Pimenov (the expert in Apiaceae taxonomy) opinion
      </span>
      <br></br>
      <br></br>
      <span style={{}}>Select classification: </span>
      {Array(...all_tags).sort().map((item, _) => (
        <button
          style={item !== tag
            ? {padding: '7px', border: '1px solid blue', borderRadius: '4px', marginLeft: '10px', backgroundColor: '#e5e2ffff',}
            : {padding: '7px', border: '1px solid yellow', borderRadius: '4px', marginLeft: '10px', backgroundColor: 'rgb(254, 255, 244)', fontWeight: 600}}
          onClick={() => {setTag(item)}}
        >{item}</button>
      ))}
      &nbsp;&nbsp;&nbsp;
      &nbsp;&nbsp;&nbsp;
      <span style={{}}>Count by: </span>
      {(["chemical", "article", "all"] as const).map((mode) => (
        <button
          key={mode}
          style={mode !== countMode
            ? {padding: '7px', border: '1px solid blue', borderRadius: '4px', marginLeft: '10px', backgroundColor: '#e5e2ffff',}
            : {padding: '7px', border: '1px solid yellow', borderRadius: '4px', marginLeft: '10px', backgroundColor: 'rgb(254, 255, 244)', fontWeight: 600}}
          onClick={() => {setCountMode(mode)}}
        >{mode}</button>
      ))}
      <br></br>
      </div>
    <PhilogeneticTree {...{species: species, meta: species_meta, meta_names: meta_names}} />
  </div>
}

export default PhilogeneticTreeOrNull;
