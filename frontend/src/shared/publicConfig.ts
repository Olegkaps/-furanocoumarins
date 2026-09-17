import { createContext, useContext } from "react";
import { api } from "./api";

export type PublicConfig = {
  taxonomy_info?: string;
  classification_autocomplete_label?: string;
  classification_autocomplete_hint?: string;
};

export const PublicConfigContext = createContext<PublicConfig>({});

export function readPublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object") return {};
  const config = value as Record<string, unknown>;
  return {
    taxonomy_info: typeof config.taxonomy_info === "string" ? config.taxonomy_info : undefined,
    classification_autocomplete_label: typeof config.classification_autocomplete_label === "string" ? config.classification_autocomplete_label : undefined,
    classification_autocomplete_hint: typeof config.classification_autocomplete_hint === "string" ? config.classification_autocomplete_hint : undefined,
  };
}

export function usePublicConfig() {
  return useContext(PublicConfigContext);
}

export async function loadPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  try {
    const response = await api.get("/config", { signal });
    return readPublicConfig(response.data);
  } catch {
    return {};
  }
}
