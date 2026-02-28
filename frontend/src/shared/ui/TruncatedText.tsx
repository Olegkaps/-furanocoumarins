import { useState, useRef } from "react";
import { Copy } from "@gravity-ui/icons";
import config from "../../config";
import "./TruncatedText.css";

export function TruncatedText({
  text,
  maxLength = 50,
}: {
  text: string;
  maxLength?: number;
}) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const isTruncated = text.length > maxLength;
  const displayText = isTruncated ? `${text.slice(0, maxLength)}...` : text;

  const handleMouseEnter = () => {
    if (isTruncated) setIsTooltipVisible(true);
  };

  const handleMouseLeave = () => {
    setIsTooltipVisible(false);
  };

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

  return (
    <div
      className="truncated-text-container"
      ref={textRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className="truncated-text"
        style={{ fontSize: config["FONT_SIZE"] }}
      >
        {displayText}
      </span>
      {isTruncated && isTooltipVisible && (
        <div className="tooltip">
          <div className="tooltip-content">
            <span>{text}</span>
            <button
              className="copy-button"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard();
              }}
              title="Copy"
            >
              <Copy height={"25px"} width={"25px"} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
