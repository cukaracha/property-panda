/**
 * The build's coarse stages and how they read in the UI.
 *
 * One ordered list, two label sets: the pipeline checklist has room for a phrase,
 * a status badge has room for a word. Both live here so the stage order and the
 * wording cannot drift between the two places a build's progress is shown.
 *
 * The stages mirror the backend's models.STAGES. The convert state machine owns all
 * seven and calls out to the agent runtime for the two that need a model, but that
 * split is invisible here — to the user it is one build.
 */
import type { OntologyStage } from '../../../services/ontologyService';

export const ONTOLOGY_STAGES: OntologyStage[] = [
  'CARRY_FORWARD',
  'CONVERT',
  'SEGMENT',
  'EXTRACT',
  'CONSOLIDATE',
  'CANONICALIZE',
  'EMIT',
];

/** Checklist wording — a phrase describing what the stage is doing. */
export const STAGE_STEP_LABEL: Record<OntologyStage, string> = {
  CARRY_FORWARD: 'Carrying forward unchanged documents',
  CONVERT: 'Converting documents',
  SEGMENT: 'Segmenting pages and chunks',
  EXTRACT: 'Extracting per page',
  CONSOLIDATE: 'Consolidating schema',
  CANONICALIZE: 'Keying and scoring the graph',
  EMIT: 'Writing outputs',
};

/** Badge wording — one word, to fit beside a title. */
export const STAGE_BADGE_LABEL: Record<OntologyStage, string> = {
  CARRY_FORWARD: 'Preparing',
  CONVERT: 'Converting',
  SEGMENT: 'Segmenting',
  EXTRACT: 'Extracting',
  CONSOLIDATE: 'Consolidating',
  CANONICALIZE: 'Keying',
  EMIT: 'Emitting',
};
