import { AlertTriangle, Check } from 'lucide-react';
import { Spinner } from '../../../components/ui/spinner';
import type {
  OntologyConvertProgress,
  OntologyExtractMetrics,
  OntologyProgress,
  OntologyStage,
} from '../../../services/ontologyService';
import { ONTOLOGY_STAGES, STAGE_STEP_LABEL } from '../utils/stageLabels';

const toSteps = (stages: OntologyStage[]) =>
  stages.map(key => ({ key, label: STAGE_STEP_LABEL[key] }));

const STAGES = toSteps(ONTOLOGY_STAGES);
// Only a build derived from another one carries documents forward. An ordinary build
// starts at CONVERT, so leaving the row in would put a completed check beside a stage
// that never ran.
const BUILD_STAGES = toSteps(ONTOLOGY_STAGES.filter(key => key !== 'CARRY_FORWARD'));

interface OntologyStepsProps {
  /** Current backend stage; undefined before the first status arrives. */
  stage?: OntologyStage;
  progress?: OntologyProgress;
  /** The conversion counter, which is a separate denominator from `progress`: it
   *  counts documents, and on a derived build only the ones actually being converted. */
  convertProgress?: OntologyConvertProgress;
  /** What extraction actually produced, recomputed from the elements that exist. Only
   *  read once EXTRACT is behind the build, for the reason in `countsFor`. */
  extract?: OntologyExtractMetrics;
  /** Bronze keys of the documents conversion has lost so far, named against the
   *  corpus below. Appended live, so this fills in while CONVERT is still running. */
  failedDocKeys?: string[];
  docKeys?: string[];
  docNames?: string[];
  uploading?: boolean;
  /** True when this build was derived from another by a corpus update. */
  isUpdate?: boolean;
}

interface StageCounts {
  done: number;
  failed: number;
  total: number;
}

/**
 * What a stage produced, and what it lost. Both Maps report the same three numbers, so
 * "Converting documents (8/10, 1 failed)" reads the same as the extraction line.
 *
 * EXTRACT is counted two different ways on purpose. While it runs, `progress.done` is
 * the only thing that moves, but it is bumped once per extract branch and a page picked
 * up again by a later sweep is counted twice, so it is clamped to the denominator to
 * stop a finished stage reading 1300 of 1259. Once the stage is behind the build the
 * honest figure is available: `extract` is derived from the element files that actually
 * exist, recomputed on every sweep, so that is what a settled row shows.
 */
function countsFor(
  key: OntologyStage,
  isActive: boolean,
  progress?: OntologyProgress,
  convertProgress?: OntologyConvertProgress,
  extract?: OntologyExtractMetrics
): StageCounts | undefined {
  if (key === 'CONVERT') return convertProgress;
  if (key !== 'EXTRACT') return undefined;
  if (!isActive && extract && extract.total > 0) {
    return { done: extract.extracted, failed: extract.failed, total: extract.total };
  }
  if (!progress) return undefined;
  return { done: Math.min(progress.done, progress.total), failed: 0, total: progress.total };
}

function counterFor(counts?: StageCounts): string {
  if (!counts || counts.total <= 0) return '';
  const failed = counts.failed > 0 ? `, ${counts.failed} failed` : '';
  return ` (${counts.done}/${counts.total}${failed})`;
}

/** Resolve the failed bronze keys to the filenames the user uploaded.
 *
 *  The join is positional against the corpus the status carries, which is the same
 *  pairing every other view of these documents uses. A key with no recorded name falls
 *  back to its own basename rather than being dropped: a document that failed is worth
 *  naming badly rather than not at all. */
function failedNames(failedDocKeys: string[], docKeys: string[], docNames: string[]): string[] {
  return failedDocKeys.map(key => {
    const at = docKeys.indexOf(key);
    return (at >= 0 && docNames[at]) || key.split('/').pop() || key;
  });
}

/**
 * Progressive pipeline checklist: completed stages keep their check and their numbers,
 * the active stage shows a spinner, and later stages stay hidden until reached.
 *
 * A stage keeps its counter after it finishes. It used to lose it the moment the build
 * moved on, so a conversion that reported five failures erased that the instant it
 * handed over, and the only remaining account of it was the report on a build that had
 * not finished yet. A stage that lost work is checked off in warning rather than cyan
 * for the same reason: "134 of 134, 5 failed" is not a clean pass and should not look
 * like one.
 *
 * The documents conversion lost are named here as they fail rather than only in the
 * report at the end, because a build that will land partial takes just as long as one
 * that will not, and knowing which file is the problem is what makes the wait useful.
 */
export default function OntologySteps({
  stage,
  progress,
  convertProgress,
  extract,
  failedDocKeys,
  docKeys,
  docNames,
  uploading,
  isUpdate,
}: OntologyStepsProps) {
  const steps = isUpdate ? STAGES : BUILD_STAGES;
  const activeIndex = uploading || !stage ? 0 : steps.findIndex(s => s.key === stage);
  const shown = uploading ? 1 : activeIndex + 1;
  const lost = failedNames(failedDocKeys ?? [], docKeys ?? [], docNames ?? []);

  return (
    <div className='flex flex-col gap-2.5 border-t border-line pt-4'>
      {uploading && (
        <div className='flex items-center gap-2.5 text-sm'>
          <span className='grid h-[22px] w-[22px] shrink-0 place-items-center'>
            <Spinner size='sm' />
          </span>
          <span className='font-medium text-ink'>Uploading documents</span>
        </div>
      )}
      {!uploading &&
        steps.slice(0, shown).map((step, i) => {
          const isActive = i === activeIndex;
          const counts = countsFor(step.key, isActive, progress, convertProgress, extract);
          const done = i < activeIndex;
          const lostWork = done && (counts?.failed ?? 0) > 0;
          return (
            <div key={step.key} className='flex flex-col gap-1'>
              <div className='flex items-center gap-2.5 text-sm'>
                <span className='grid h-[22px] w-[22px] shrink-0 place-items-center'>
                  {lostWork ? (
                    <AlertTriangle size={15} className='text-rose' />
                  ) : done ? (
                    <Check size={16} className='text-cyan' />
                  ) : (
                    <Spinner size='sm' />
                  )}
                </span>
                <span className={isActive ? 'font-semibold text-ink' : 'text-ink-3'}>
                  {step.label}
                  {counterFor(counts)}
                </span>
              </div>
              {step.key === 'CONVERT' && lost.length > 0 && (
                <ul className='ml-[32px] flex flex-col gap-0.5'>
                  {lost.map(name => (
                    <li key={name} className='truncate text-[11.5px] text-rose'>
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </div>
  );
}
