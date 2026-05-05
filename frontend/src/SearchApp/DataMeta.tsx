import React from "react";
import { ArrowUpRightFromSquare, Copy } from "@gravity-ui/icons";
import { TruncatedText } from "../shared/ui/TruncatedText";

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error("Copy error: ", err);
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } catch (fallbackErr) {
      console.error("Copy fallback error: ", fallbackErr);
    }
    document.body.removeChild(textArea);
  }
}

function SmilesMetaBlock({ value }: { value: string }) {
  const canvasId = `${value}_${generateRandomString(5)}`;
  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        maxWidth: 320,
      }}
    >
      <button
        type="button"
        title="Copy SMILES"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copyTextToClipboard(value);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          zIndex: 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          border: "none",
          borderRadius: 4,
          background: "rgba(255, 255, 255, 0.92)",
          cursor: "pointer",
          padding: "4px 8px",
          fontSize: "11px",
          fontWeight: 500,
          color: "#666",
        }}
      >
        <Copy width={14} height={14} />
        copy smiles
      </button>
      <canvas id={canvasId} className="smiles">
        {value}
      </canvas>
    </div>
  );
}

function generateRandomString(length: number): string {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

let ignore_link_prefixes = ["fuco", "NoIPNI", "NoKew"];

class Link {
  id: string;
  text: string;

  constructor(id: string, text: string) {
    this.id = id;
    this.text = text;
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
    return <p><TruncatedText text={value} maxLength={max_length}/>{extra_item}</p>}

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
    return <SmilesMetaBlock value={value} />;
  }

  render_reference(value: string) {
    return <a target="_blank" href={"/reference/" + value}>{this.render_default(value)}</a>
  }
}


export default DataMeta;
