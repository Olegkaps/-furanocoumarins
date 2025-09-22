import config from "../config"


class DataMeta {
  type: string
  name: string
  additional_data: string

  constructor(type: string, name: string, data: string) {
    this.type = type
    this.name = name
    this.additional_data = data
  }

  render(value: string) { // rewrite to classes
    if (this.type === "link") {
      return this.render_link(value)
    } else if (this.type === "cls") {
      return this.render_cls(value)
    } else if (this.type === "smiles") {
      return this.render_smiles(value)
    } else {
      return <>
        <p>Not Found</p>{/* // TO FIX */}
      </>
    }
  }

  render_link(value: string) {
    return <>
      <a style={{fontSize: config["FONT_SIZE"],}} href={this.additional_data + "/" + value}>{value}</a>
    </> // TO DO
  }

  render_cls(value: string) {
    return <>
      <p style={{fontSize: config["FONT_SIZE"],}}>{value}</p>
    </> // TO DO
  }

  render_smiles(value: string) {
    return <>
      <p style={{fontSize: config["FONT_SIZE"],}}>{value}</p>
    </> // TO DO
  }
}


export default DataMeta;
