import { isEmpty, ZoomableContainer } from "../Admin/utils";
import config from "../config";


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

  render(meta: Array<string>, meta_ind: number = 0, child_ind: number = 0, total_bros: number = 0) {
    return <div key={meta[meta_ind] + "_" + this.clade_name}
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
          title={meta[meta_ind]}>
            {this.clade_name.replace(' ', '\u00A0')}
          </p>
        </div>
        {!(Object.keys(this.childs).length <= 1 && total_bros === 1) && !(meta_ind === 1 && total_bros === 1)
        && <div style={{
          position: 'relative',
          top: '-15px',
          right: '25px',
        }}>
          <CountButton {...{color: '#fae6b0', number: this.childs_num}} />
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
                {this.childs[name].render(meta, meta_ind+1, ind, Object.keys(this.childs).length)}
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


function CountButton({color, number}: {color: string, number: number}) {
  return <button
    onClick={() => {}}
    style={{
      backgroundColor: color,
      padding: '4px 5px 6px 5px',
      border: '0',
      borderRadius: '40%',
      position: 'absolute',
      fontSize: config["FONT_SIZE"],
      fontWeight: 700,
      width: '50px',
    }}>
      {number}
    </button>
}


function PhilogeneticTree({ species, meta }: {species: Array<Specie>, meta: Array<string>}) {
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


  return <ZoomableContainer>{root.render(meta)}</ZoomableContainer>
}


function PhilogeneticTreeOrNull(
    {response, tag, setTag}:
    {response: {[index: string]: any},
    tag: string,
    setTag: React.Dispatch<React.SetStateAction<string>>},
  ) {
  if (isEmpty(response)) {
    return <div></div>
  }

  let metadata_response = response["metadata"]
  metadata_response.sort((a: { [x: string]: number; }, b: { [x: string]: number; }) => {
    if (a["type"] === b["type"]) {
      return 0
    } else if (a["type"] < b["type"]) {
      return 1
    }
    return -1
  })

  let species_meta = ["__root__"]
  let class_num_to_tag: {[val: string]: string} = {}

  let all_tags = new Set<string>()
  all_tags.add("default")
  all_tags.add(tag)

  metadata_response.forEach((meta_item: {[index: string]: any}) => {
    // e.g 'clas[00]', 'clas[02][powo]', ...
    let _type = meta_item["type"]    
    if (!_type.startsWith("clas[")) {
      return
    }
  
    let curr_num: string = _type.split("[")[1].split("]")[0]

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
    class_num_to_tag[curr_num] = curr_tag
  })

  let counts: {[index: string]: number} = {}
  
  response["data"]?.forEach((row: {[index: string]: string}) => {
    let clades: Array<string> = []

    species_meta.forEach((clade_name: string, ind: number) => {
      if (ind === 0) {
        return
      }
      let value = row[clade_name]
      clades.push(value)
    })

    let joined_clades = clades.join("@")
    if (!(joined_clades in counts)) {
      counts[joined_clades] = 0
    }
    counts[joined_clades] += 1
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
      <span style={{}}>Classification: </span>
      {Array(...all_tags).sort().map((item, _) => (
        <button
          style={item !== tag ? 
            {padding: '7px', border: '1px solid blue', borderRadius: '4px', marginLeft: '10px', backgroundColor: '#e5e2ffff',}
          : {padding: '7px', border: '1px solid yellow', borderRadius: '4px', marginLeft: '10px', backgroundColor: '#fcffe2ff',}}
          onClick={() => {setTag(item)}}
        >{item}</button>
      ))}</div>
    <PhilogeneticTree {...{species: species, meta: species_meta}} />
  </div>
}

export default PhilogeneticTreeOrNull;
