import { isEmpty } from "../shared/api";
import { cachedSearch } from "../shared/apiCache";

export async function fetchSearchResult(
  e: React.FormEvent | null,
  searchReq: string,
  setSearchResponse: React.Dispatch<React.SetStateAction<{ [index: string]: any }>>
) {
  e?.preventDefault();
  const data = await fetchSearchData(searchReq);
  if (data != null) {
    setSearchResponse(data);
  }
}

/** Fetch search JSON or null on error (alert already shown). */
export async function fetchSearchData(
  searchReq: string,
): Promise<{ [index: string]: any } | null> {
  const response = await cachedSearch(searchReq).catch(
    (err: { response?: { status: number; data: any } }) => err?.response,
  );

  if (response && response.status === 200) {
    return response.data;
  }
  alert("Error: " + response?.status + " - " + response?.data?.error);
  return null;
}

export function filterResponse(searchResponse: { [index: string]: any }) {
  if (isEmpty(searchResponse)) {
    return searchResponse;
  }

  const resultResponse: { [index: string]: any } = {};
  resultResponse["metadata"] = [];
  searchResponse["metadata"]?.forEach((meta_item: { [index: string]: any }) => {
    if (!meta_item["type"].includes("invisible")) {
      resultResponse["metadata"].push(meta_item);
    }
  });

  resultResponse["data"] = [];

  const meta_defaults: { [ind: string]: any } = {};
  searchResponse["metadata"]?.forEach((meta_item: { [index: string]: any }) => {
    const _type = meta_item["type"];
    if (!_type.includes("clas[") || _type.includes("invisible")) return;
    const curr_num = _type.split("clas[")[1].split("]")[0];
    if (!(curr_num in meta_defaults)) {
      meta_defaults[curr_num] = { default: "", custom: [] };
    }
    let curr_tag = "default";
    if (_type.includes("][")) {
      curr_tag = _type.split("][")[1].split("]")[0];
    }
    if (curr_tag === "default") {
      meta_defaults[curr_num]["default"] = meta_item["column"];
    } else {
      meta_defaults[curr_num]["custom"].push(meta_item["column"]);
    }
  });

  searchResponse["metadata"]?.forEach((meta_item: { [index: string]: any }) => {
    const _type = meta_item["type"];
    if (!_type.includes("default[") || _type.includes("invisible")) return;
    const default_col = _type.split("default[")[1].split("]")[0];
    if (!(default_col in meta_defaults)) {
      meta_defaults[default_col] = { default: default_col, custom: [] };
    }
    meta_defaults[default_col]["custom"].push(meta_item["column"]);
  });

  searchResponse["data"]?.forEach((row: { [index: string]: string }) => {
    Object.values(meta_defaults).forEach((obj: { default: string; custom: string[] }) => {
      const default_col = obj["default"];
      obj["custom"].forEach((col: string) => {
        const value = row[col] ?? "";
        if (value.replaceAll(" ", "") === "") {
          row[col] = row[default_col];
        } else if (value.replaceAll(" ", "") === "NoValue") {
          row[col] = "";
        }
      });
    });
    resultResponse["data"].push(row);
  });

  return resultResponse;
}
