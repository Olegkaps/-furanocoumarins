export interface ParsedMetadataType {
  tokens: Set<string>;
  modifiers: Map<string, string[]>;
}

export function parseMetadataType(columnType: string): ParsedMetadataType | null;
export function hasMetadataTypeToken(columnType: string, expected: string): boolean;
export function getMetadataTypeModifier(columnType: string, marker: string): string[] | null;
export function safeMetadataLink(template: string, value: string): string | null;
