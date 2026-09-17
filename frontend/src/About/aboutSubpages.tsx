import { BookOpen, CircleInfo, Database, FileCode, Flask, Gear, Globe, Molecule } from "@gravity-ui/icons";

const icons = { info: CircleInfo, chemicals: Molecule, species: Globe, references: BookOpen, methods: Flask, data: Database, book: BookOpen, document: FileCode, flask: Flask, leaf: Gear, table: Database };

export function AboutIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const Icon = icons[icon as keyof typeof icons] ?? CircleInfo;
  return <Icon width={size} height={size} aria-hidden="true" />;
}
