import React from "react";
import { ArrowUpRightFromSquare, Copy } from "@gravity-ui/icons";
import { TruncatedText } from "../shared/ui/TruncatedText";
import { CitationRefList } from "../shared/ui/CitationPopover";
import "../shared/ui/CitationPopover.css";

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
  const canvasId = `smiles_${generateRandomString(8)}`;
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
        className="btn"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          zIndex: 1,
          padding: "4px 8px",
          fontSize: "11px",
        }}
      >
        <Copy width={14} height={14} />
        copy smiles
      </button>
      <canvas id={canvasId} className="smiles" data-smiles={value}>
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

    return (
      <span className="meta-link-list">
        {links.map((link, i) => (
          <React.Fragment key={`${link.id}-${i}`}>
            {i > 0 && <span>, </span>}
            <a
              className="meta-link"
              href={this.additional_data.replace("%s", link.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="meta-link__text">
                <TruncatedText text={link.text} maxLength={70} />
              </span>
              <ArrowUpRightFromSquare className="meta-link__icon" width={14} height={14} aria-hidden />
            </a>
          </React.Fragment>
        ))}
      </span>
    );
  }

  render_cls(value: string) {
    return this.render_default(value) // TO DO
  }

  render_smiles(value: string) {
    return <SmilesMetaBlock value={value} />;
  }

  render_reference(value: string) {
    if (!value.trim()) {
      return <></>;
    }
    return <CitationRefList value={value} />;
  }
}


export default DataMeta;
