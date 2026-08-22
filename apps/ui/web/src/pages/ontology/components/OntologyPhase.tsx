import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import GraphLegend from './GraphLegend';
import GraphLoadError from './GraphLoadError';
import NodeDetailPanel from './NodeDetailPanel';
import NodeFinder from './NodeFinder';
import OntologyGraph from './OntologyGraph';
import SchemaPanel from './SchemaPanel';
import { useElementSize } from '../hooks/useElementSize';
import type { Palette } from '../utils/graphColors';
import type { NodeDatum, ParsedOntology } from '../types/ontology';

export type OntologySubView = 'graph' | 'schema';

interface OntologyPhaseProps {
  result: ParsedOntology;
  jobId: string | null;
  isPartial: boolean;
  palette: Palette;
  typeColors: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedNode: NodeDatum | null;
  subView: OntologySubView;
  onSubViewChange: (view: OntologySubView) => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  /** Open the account of what this build lost and how to finish it. Absent when
   *  there is no status to report from, which leaves the badge as a plain label. */
  onShowReport?: () => void;
}

/**
 * Phase 2 — the result. The graph and the consolidated schema are two views of the
 * same build, switched without touching the canvas: remounting the graph to look at
 * a table would throw away a settled simulation and the user's selection with it.
 *
 * The control column is real layout rather than an overlay, so the canvas owns its
 * whole box and zoom-to-fit always lands the graph in clear space.
 */
export default function OntologyPhase({
  result,
  jobId,
  isPartial,
  palette,
  typeColors,
  selectedId,
  onSelect,
  selectedNode,
  subView,
  onSubViewChange,
  legendOpen,
  onToggleLegend,
  onShowReport,
}: OntologyPhaseProps) {
  const { ref: graphRef, width, height } = useElementSize<HTMLDivElement>();
  const hasNodes = result.nodes.length > 0;

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-none flex-wrap items-start justify-between gap-3 border-b border-line bg-canvas px-[18px] py-3'>
        <div className='min-w-[190px] flex-1'>
          <div className='flex flex-wrap items-baseline gap-2'>
            <h2 className='text-[14.5px] font-semibold tracking-[-0.012em] text-ink'>
              Knowledge graph
            </h2>
            <span className='text-[12.5px] tabular-nums text-ink-3'>
              {result.graph.nodes.length} nodes · {result.graph.links.length} relations ·{' '}
              {result.schema.types.length} types
            </span>
          </div>
          {jobId && (
            <div className='mt-1 truncate font-mono text-[11px] text-ink-4'>
              Build id {jobId}
              {result.schema.revision ? ` · schema r${result.schema.revision}` : ''}
            </div>
          )}
        </div>

        <div className='flex flex-wrap items-center justify-end gap-2'>
          {/* The one place a finished build says it lost something, so it is also the
              way in to what it lost. A button rather than a label wherever there is a
              report to open, which is everywhere the status was actually seen. */}
          {isPartial &&
            (onShowReport ? (
              <button
                type='button'
                onClick={onShowReport}
                title='See what this build could not finish'
                className='rounded-control focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-line'
              >
                <Badge tone='warning' className='cursor-pointer hover:opacity-80'>
                  Partial result
                </Badge>
              </button>
            ) : (
              <Badge tone='warning'>Partial result</Badge>
            ))}
          {subView === 'graph' && hasNodes && (
            <NodeFinder nodes={result.nodes} typeColors={typeColors} onSelect={onSelect} />
          )}
          <div className='flex gap-1 rounded-control border border-line bg-panel p-1'>
            <Button
              size='sm'
              variant={subView === 'graph' ? 'default' : 'ghost'}
              aria-pressed={subView === 'graph'}
              onClick={() => onSubViewChange('graph')}
            >
              Graph
            </Button>
            <Button
              size='sm'
              variant={subView === 'schema' ? 'default' : 'ghost'}
              aria-pressed={subView === 'schema'}
              onClick={() => onSubViewChange('schema')}
            >
              Schema
            </Button>
          </div>
        </div>
      </div>

      {subView === 'schema' ? (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <SchemaPanel schema={result.schema} typeColors={typeColors} />
        </div>
      ) : (
        <>
          <div className='flex min-h-[170px] flex-1 items-stretch'>
            {hasNodes && (
              <div className='flex min-h-0 w-[170px] flex-none flex-col overflow-hidden border-r border-line bg-canvas min-[900px]:w-[186px] min-[1200px]:w-[208px]'>
                <GraphLegend
                  nodes={result.nodes}
                  typeColors={typeColors}
                  open={legendOpen}
                  onToggle={onToggleLegend}
                />
              </div>
            )}
            <div ref={graphRef} className='relative min-w-0 flex-1'>
              <div className='absolute inset-0 overflow-hidden'>
                {width > 0 && (
                  <ErrorBoundary fallback={<GraphLoadError />}>
                    <OntologyGraph
                      data={result.graph}
                      width={width}
                      height={height}
                      palette={palette}
                      typeColors={typeColors}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  </ErrorBoundary>
                )}
              </div>
              <span className='pointer-events-none absolute bottom-2.5 right-3.5 text-[11px] text-ink-4'>
                Scroll to zoom · drag to pan · click a node
              </span>
            </div>
          </div>

          <div className='flex h-[216px] min-h-[132px] flex-none shrink flex-col border-t border-line bg-canvas'>
            <NodeDetailPanel node={selectedNode} />
          </div>
        </>
      )}
    </div>
  );
}
