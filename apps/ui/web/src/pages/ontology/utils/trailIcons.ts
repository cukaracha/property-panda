/**
 * Glyph per tool for the search trail, so a page read, a graph walk and a dispatched
 * subagent are told apart without reading the line.
 *
 * Same lookup-with-a-fallback shape as the LMS agent's `components/assistant/toolMeta`,
 * kept separate because these are the ontology agent's own primitives and nothing else
 * calls them. An unmapped tool gets the wrench rather than nothing, so a tool added to
 * the agent still renders.
 *
 * The lookup returns `{ icon }` rather than the component itself, which reads like
 * indirection for its own sake and is not: binding a returned component to a
 * capitalized local is what `react-hooks` reports as creating a component during
 * render. Rendering it off a property is why the reference table is shaped this way too.
 */
import { Bot, FileText, LayoutDashboard, Network, Search, Waypoints, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// `Agent` and `Task` are both listed because the dispatcher's name depends on which
// CLI the container pins (see the agent's roles.DISPATCH_TOOLS).
export interface TrailIcon {
  icon: LucideIcon;
}

const TRAIL_ICONS = {
  vector_search: { icon: Search },
  retrieve_pages: { icon: FileText },
  page_relations: { icon: Waypoints },
  neighbor_pages: { icon: Network },
  build_overview: { icon: LayoutDashboard },
  Agent: { icon: Bot },
  Task: { icon: Bot },
} satisfies Record<string, TrailIcon>;

export function trailIcon(name: string): TrailIcon {
  return (TRAIL_ICONS as Record<string, TrailIcon>)[name] ?? { icon: Wrench };
}

/**
 * Split a tool step into the tool's name and what it was called with.
 *
 * The agent emits `{name} {summary}` in one string, and a bare tool name never
 * contains a space, so the first one is the boundary. Parsed here rather than sent
 * structured, because the runtime's stream contract is one `{type, content}` shape for
 * every event and one panel is not a reason to add a second.
 */
export function splitTrailStep(content: string): { name: string; detail: string } {
  const space = content.indexOf(' ');
  if (space < 0) return { name: content, detail: '' };
  return { name: content.slice(0, space), detail: content.slice(space + 1) };
}
