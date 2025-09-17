import React, { useEffect, useRef, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

export default function CodeBlock({ code, language, onRun }) {
  const ref = useRef();
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (ref.current) {
      hljs.highlightElement(ref.current);
    }
  }, [code]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
  };

  const runCode = async () => {
    if (onRun) {
      const result = await onRun(code, language);
      setOutput(result);
    }
  };

  const isLong = code.split("\n").length > 15;

  return (
    <div className="code-block-container">
      <div className="code-toolbar">
        <span className="lang-label">{language || "code"}</span>
        <button onClick={copyToClipboard}>Copy</button>
        {onRun && <button onClick={runCode}>Run</button>}
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
      <pre
        style={{
          maxHeight: !expanded && isLong ? "300px" : "none",
          overflow: "auto",
          background: "#676768ff",
          borderRadius: "6px",
          padding: "10px",
          fontFamily: "Menlo, Monaco, 'Courier New', monospace",
          fontSize: "13px",
          lineHeight: "1.4",
          whiteSpace: "pre", // preserve indentation exactly
        }}
      >
        <code ref={ref} className={language}>
          {code}
        </code>
      </pre>
      {output && (
        <div className="code-output">
          <strong>Output:</strong>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}
