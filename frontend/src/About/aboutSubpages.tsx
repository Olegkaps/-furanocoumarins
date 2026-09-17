import { BookOpen, CircleInfo, Database, FileCode, Flask, Gear } from "@gravity-ui/icons";

const icons = { info: CircleInfo, book: BookOpen, document: FileCode, flask: Flask, leaf: Gear, table: Database };

export function AboutIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const Icon = icons[icon as keyof typeof icons] ?? CircleInfo;
  return <Icon width={size} height={size} aria-hidden="true" />;
}
