import config from "../config"
import {ArrowUpRightFromSquare} from '@gravity-ui/icons';


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
  description: string
  additional_data: string

  constructor(type: string, name: string, description: string, data: string) {
    // TO DO: validate type
    this.type = type
    this.name = name
    this.description = description
    this.additional_data = data
  }

  render(value: string) { // rewrite to classes
    if (this.type == "") {
      return this.render_default(value)
    } else if (this.type === "link") {
      return this.render_link(value)
    } else if (this.type === "clas") {
      return this.render_cls(value)
    } else if (this.type === "smiles") {
      return this.render_smiles(value)
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
      <a href={this.additional_data.replace("%s", link.id)}>
        {this.render_default(link.text, 70, <>&nbsp;<ArrowUpRightFromSquare /></>)}
      </a>
    ))}
    </>
  }

  render_cls(value: string) {
    return this.render_default(value) // TO DO
  }

  render_smiles(value: string) {
    return this.render_default(value) // TO DO
  }
}


export default DataMeta;
