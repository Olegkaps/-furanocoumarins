export type AboutSubpage = { id: string; name: string; icon: string };

export const ABOUT_ICON_CHOICES = [
  { value: "info", label: "Info" },
  { value: "book", label: "Book" },
  { value: "document", label: "Document" },
  { value: "flask", label: "Research" },
  { value: "leaf", label: "Plant" },
  { value: "table", label: "Data" },
] as const;

export function aboutPageStorageName(id: string) {
  return `about-subpage-${id}`;
}
