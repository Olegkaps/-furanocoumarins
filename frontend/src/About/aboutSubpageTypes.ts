export type AboutSubpage = { id: string; name: string; icon: string };

export const ABOUT_ICON_CHOICES = [
  { value: "info", label: "Info" },
  { value: "chemicals", label: "Chemicals" },
  { value: "species", label: "Species" },
  { value: "references", label: "References" },
  { value: "methods", label: "Methods" },
  { value: "data", label: "Data" },
] as const;

export function aboutPageStorageName(id: string) {
  return `about-subpage-${id}`;
}
