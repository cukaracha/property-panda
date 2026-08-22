/**
 * Maps each LMS agent tool name to a Lucide icon component + human label for the
 * thinking-card timeline. Unknown tools fall back to a generic wrench + the raw
 * tool name. Ported from the reference handoff TOOL_META table.
 */
import {
  Search,
  ChartColumn,
  CalendarClock,
  FileCheck2,
  GraduationCap,
  ChartPie,
  ListTree,
  PencilLine,
  LayoutDashboard,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ToolMeta {
  icon: LucideIcon;
  label: string;
}

const TOOL_META = {
  search_course_materials: { icon: Search, label: 'Searching course materials' },
  course_knowledge_base: { icon: Search, label: 'Searching course materials' },
  get_module_progress: { icon: ChartColumn, label: 'Reading module progress' },
  get_due_dates: { icon: CalendarClock, label: 'Checking the unit schedule' },
  get_submission_status: { icon: FileCheck2, label: 'Checking submission status' },
  get_grades: { icon: GraduationCap, label: 'Pulling your grades' },
  get_weightings: { icon: ChartPie, label: 'Weighing assessments' },
  get_module_outline: { icon: ListTree, label: 'Reading the module outline' },
  generate_practice: { icon: PencilLine, label: 'Drafting practice questions' },
  get_student_context: { icon: LayoutDashboard, label: 'Loading your context' },
} satisfies Record<string, ToolMeta>;

export function toolMeta(name: string): ToolMeta {
  return (TOOL_META as Record<string, ToolMeta>)[name] ?? { icon: Wrench, label: name };
}
