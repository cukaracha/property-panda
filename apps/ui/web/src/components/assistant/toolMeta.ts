/**
 * Maps each agent tool name to a Lucide icon + human label for the thinking-card
 * timeline. Unknown tools fall back to a generic wrench + the raw tool name.
 */
import { Search, Globe, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ToolMeta {
  icon: LucideIcon;
  label: string;
}

const TOOL_META = {
  WebSearch: { icon: Search, label: 'Searching the web' },
  WebFetch: { icon: Globe, label: 'Reading a page' },
} satisfies Record<string, ToolMeta>;

export function toolMeta(name: string): ToolMeta {
  return (TOOL_META as Record<string, ToolMeta>)[name] ?? { icon: Wrench, label: name };
}
