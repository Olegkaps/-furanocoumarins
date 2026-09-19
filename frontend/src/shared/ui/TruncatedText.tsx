import { useEffect, useRef, useState } from "react";
import { Copy, Xmark } from "@gravity-ui/icons";
import config from "../../config";
import "./TruncatedText.css";

export function TruncatedText({
  text,
  maxLength = 50,
  controlOnly = false,
}: {
  text: string;
  maxLength?: number;
  /** Use beside another interactive element (for example, a metadata link). */
  controlOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const isTruncated = text.length > maxLength;

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("keydown", dismiss);
      trigger?.focus();
    };
  }, [open]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("Copy error: ", err);
      fallbackCopyTextToClipboard(text);
    }
  };

  function fallbackCopyTextToClipboard(text: string) {
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
    } catch (err) {
      console.error("Copy fallback error: ", err);
    }
    document.body.removeChild(textArea);
  }

  if (!isTruncated && !controlOnly) return <span className="truncated-text" style={{ fontSize: config["FONT_SIZE"] }}>{text}</span>;
  return <>
    <button ref={triggerRef} type="button" className="truncated-text truncated-text--button" style={{ fontSize: config["FONT_SIZE"] }} onClick={() => setOpen(true)} aria-label="Show full value">{controlOnly ? "Full value" : `${text.slice(0, maxLength)}…`}</button>
    {open && <div className="value-dialog-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section ref={dialogRef} tabIndex={-1} className="value-dialog" role="dialog" aria-modal="true" aria-label="Full cell value" onMouseDown={event => event.stopPropagation()}>
        <header><strong>Full value</strong><button type="button" className="btn" onClick={() => setOpen(false)} aria-label="Close full value"><Xmark width={16} height={16} /></button></header>
        <pre>{text}</pre>
        <footer><button type="button" className="btn" onClick={() => { void copyToClipboard(); }}><Copy width={16} height={16} /> Copy</button></footer>
      </section>
    </div>}
  </>;
}
