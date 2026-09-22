import type { OmicsRecord } from "./omics";

export default function OmicsRecordList({ name, count, records }: { name: string; count: number; records: OmicsRecord[] }) {
  return <details className="omics-record-list">
    <summary><span>{name}</span><small>{count}</small></summary>
    <div className="omics-record-list__menu">
      {records.length ? <ul>{records.map((record, index) => <li key={`${record.accession}:${index}`}>
        <a href={record.href} target="_blank" rel="noreferrer">
          <span>{record.label || record.accession}</span>
          <small>{[record.accession, record.species].filter(Boolean).join(" · ")}</small>
        </a>
      </li>)}</ul> : <p>No matching records.</p>}
    </div>
  </details>;
}
