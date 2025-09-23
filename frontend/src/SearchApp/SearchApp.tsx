import { useState } from 'react';

import {ChevronRight} from '@gravity-ui/icons';
import config from '../config';
import DataMeta from './DataMeta';
import { useNavigate } from 'react-router-dom';


function isEmpty(obj: object) {
  return Object.keys(obj).length === 0;
}


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
      }}>
        <TreeCladesAdapter {...{
          drawLeftBorder: meta_ind === 0 || child_ind === 0
        }} />
        <TreeCladeLine />
        <div style={{
          position: 'relative',
          top: '-40px',
          right: '-70%',
        }}>
          <p style={{
            position: 'absolute',
            fontSize: config["FONT_SIZE"],
            fontWeight: 600,
          }}>
            {this.clade_name.replace(' ', '\u00A0')}
          </p>
        </div>
        {!(Object.keys(this.childs).length <= 1 && total_bros === 1)
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
          <div style={{
              position: 'relative',
              paddingBottom: '35px',
              top: '5px',
          }}>
            <CountButton {...{color: '#007bff', number: this.childs_num}} />
          </div>
        :
          <div>{
            Object.keys(this.childs).map((name, ind) => (
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
  // TO DO: all nested arrays must have same lenght eith meta
  // TO DO: all arrays must be unique
  let root = new PhilogeneticTreeNode("")
  for(let specie of species) {
    root.add_child(specie.clades, specie.values_count)
  }

  // TO DO: Add visibility for branches and clades

  return <div className="tree" style={{marginRight: '50px',}}>{root.render(meta)}</div>
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
  return <div className='table'>
    <table style={{margin: 'auto',}}>
      <ResultTableHead {...{meta: meta}} />
      <ResultTableBody {...{meta: meta, rows: rows}} />
    </table>
  </div>
}


function SearchLine() {
  const [request, setRequest] = useState("")
  return <div className="card">
      <form className="main_form" onSubmit={() => alert("your request is: " + request)}>
        <input type="text" className="search-teaxtarea" onChange={(text) => setRequest(text.target.value)} style={{fontSize: config["FONT_SIZE"]}}></input>
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
  let species = [
    new Specie(6, ["A", "ASGARD", "gr 1"]),
    new Specie(1, ["A", "ASGARD", "gr 2"]),
    new Specie(5, ["A", "???", "E"]),
    new Specie(1, ["B", "C", "D"]),
    new Specie(3, ["Y", "Plant", "Rose"]),
    new Specie(10, ["Y", "Plant", "Amarant"]),
    new Specie(506, ["Y", "Plant", "Arabidopsis"]),
    new Specie(45, ["Y", "Plant", "Mais"]),
    new Specie(1, ["Y", "Plant", "ndjfd"]),
    new Specie(23, ["Y", "Plant", "pl 1"]),
    new Specie(1, ["Y", "Plant", "pl 2"]),
    new Specie(3, ["Y", "Animal", "Bear"]),
    new Specie(1, ["Y", "Animal", "Fish"]),
  ]
  let species_meta = [
    "root",
    "Domain",
    "reign",
    "tribe"
  ]
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

  let navigate = useNavigate();

  return <>
    <div>
      <button onClick={() => {navigate("/admin")}}>admin</button>
      <br></br>
      <button onClick={() => {navigate("/login")}}>login</button>
      <br></br>
      <button onClick={() => {navigate('/admit/psw-12')}}>confirm change password</button>
      <br></br>
      <button onClick={() => {navigate('/admit/lin-12')}}>confirm email</button>
    </div>
    <br></br>
    <SearchLine />
    <b></b> {/* this doent works */}
    <PhilogeneticTree {...{species: species, meta: species_meta}} />
    <br></br>
    <ResultTable {...{rows: data, meta: data_meta}}/>
  </>
}


export default SearchApp
