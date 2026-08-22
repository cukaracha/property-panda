/* ============================================================
   Topic registry. The two seeded demo topics, each backed by a markdown
   document from the seed corpus (infra/seed, the Bedrock KB source of truth),
   imported as a raw string via the @seed alias (see vite.config.ts). A topic's
   `id` is both its route param (/topics/:topicId) and the topic_id sent to the
   agent so it can scope the course_knowledge_base tool.
   ============================================================ */

import { Atom, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import quantumPhysicsMd from '@seed/quantum_physics/double-slit-experiment.md?raw';
import italianRenaissanceMd from '@seed/art_history/italian-renaissance.md?raw';

export interface Topic {
  /** KB scope id — the route param AND the topic_id sent to the agent. */
  id: string;
  /** Short label shown as the content-page eyebrow. */
  code: string;
  title: string;
  blurb: string;
  /** Nav icon for the sidebar Knowledge Base group. */
  icon: LucideIcon;
  /** The seed corpus document rendered on the content page. */
  markdown: string;
  /** "Try asking" chips (UI only, never sent to the agent). */
  suggestions: string[];
}

export const TOPICS: Topic[] = [
  {
    id: 'phys2001',
    code: 'PHYS2001',
    title: 'Quantum Physics',
    blurb:
      'The strange, beautiful rules of the quantum world — from wave-particle duality to quantum measurement.',
    icon: Atom,
    markdown: quantumPhysicsMd,
    suggestions: [
      'Explain wave-particle duality',
      'Explain the double-slit experiment',
      'What is the de Broglie wavelength?',
    ],
  },
  {
    id: 'arth1000',
    code: 'ARTH1000',
    title: 'Art History',
    blurb:
      'From Giotto to the High Renaissance — how Italian artists reinvented space, the figure, and the idea of the artist.',
    icon: Palette,
    markdown: italianRenaissanceMd,
    suggestions: [
      'Summarise the Italian Renaissance',
      'What is linear perspective?',
      'What is chiaroscuro?',
    ],
  },
];

const BY_ID: Record<string, Topic> = Object.fromEntries(TOPICS.map(t => [t.id, t]));

/** Look up a topic by id. Falls back to the first seeded topic for an unknown id. */
export function getTopic(id?: string): Topic {
  return (id && BY_ID[id]) || TOPICS[0];
}
