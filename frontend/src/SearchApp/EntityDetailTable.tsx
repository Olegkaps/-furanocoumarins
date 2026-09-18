import DataMeta from "./DataMeta";
import { InfoTip } from "../shared/ui/InfoTip";

export function EntityDetailTable({ meta, row }: { meta: DataMeta[]; row: Map<string, string> }) {
  let markedInfo = false;
  return <table style={{ width: "100%", tableLayout: "fixed" }}><tbody>{meta.map((column) => {
    const tipTour = !markedInfo && column.description?.trim() ? ((markedInfo = true), "table-detail-info") : undefined;
    return <tr key={column.name}><td style={{ width: "42%", wordBreak: "break-word" }}><InfoTip text={column.description} dataTour={tipTour} />&nbsp;{column.show_name}</td><td style={{ width: "58%", wordBreak: "break-word" }}>{column.render(row.get(column.name))}</td></tr>;
  })}</tbody></table>;
}
