import { Info, Quote } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import RoleBadge from './RoleBadge';
import type { NodeDatum } from '../types/ontology';

interface NodeDetailPanelProps {
  node: NodeDatum | null;
}

/**
 * Inspector for the selected node — reads the RAW parsed record (not the
 * force-graph sim object), so aliases and provenance survive the canvas mutations.
 *
 * A tray under the canvas rather than a column beside it: the four groups read
 * across, which is what finally gives Evidence room to be a quotation, and the
 * parent's fixed height means selecting a node never moves the graph.
 */
export default function NodeDetailPanel({ node }: NodeDetailPanelProps) {
  if (!node) {
    return (
      <div className='flex flex-1 items-center justify-center gap-3 p-5 text-center'>
        <span className='grid h-[34px] w-[34px] shrink-0 place-items-center rounded-control border border-line bg-panel-2 text-ink-3'>
          <Info className='h-4 w-4' />
        </span>
        <p className='text-[13px] text-ink-3'>
          Select a node to inspect its type, scores, and provenance.
        </p>
      </div>
    );
  }

  const stat = (labelText: string, value: string | number) => (
    <div>
      <div className='type-ui-eyebrow text-ink-4'>{labelText}</div>
      <div className='mt-0.5 text-[17px] font-semibold tabular-nums text-ink'>{value}</div>
    </div>
  );

  return (
    <div className='grid flex-1 gap-x-[22px] gap-y-4 overflow-y-auto px-[18px] pb-4 pt-3.5 [grid-template-columns:repeat(auto-fit,minmax(212px,1fr))]'>
      <div className='flex flex-col gap-2'>
        <h3 className='truncate text-base font-semibold tracking-[-0.015em] text-ink'>
          {node.name}
        </h3>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge tone='positive'>{node.label || node.type}</Badge>
          <RoleBadge role={node.role} />
        </div>
        {node.role === 'identifier' && node.norm && (
          <div>
            <div className='type-ui-eyebrow text-ink-4'>Canonical key</div>
            <div className='break-all font-mono text-xs text-ink-2'>{node.norm}</div>
          </div>
        )}
        {node.event_date && (
          <div>
            <div className='type-ui-eyebrow text-ink-4'>Event date</div>
            <div className='font-mono text-xs text-ink-2'>{node.event_date}</div>
          </div>
        )}
      </div>

      <div className='grid grid-cols-3 gap-x-3 gap-y-3 self-start'>
        {stat('Pages', node.page_df)}
        {stat('Degree', node.degree)}
        {stat('Rarity (idf)', node.idf.toFixed(2))}
        {stat('Eligible', node.eligible ? 'Yes' : 'No')}
        {stat('Semantic', node.semantic ? 'Yes' : 'No')}
      </div>

      <div className='flex flex-col gap-3'>
        {node.evidence && (
          <div>
            <div className='type-ui-eyebrow mb-1 flex items-center gap-1.5 text-ink-4'>
              <Quote className='h-3 w-3' />
              Evidence
            </div>
            <blockquote className='border-l-2 border-accent-line pl-[11px] text-[12.5px] italic leading-relaxed text-ink-2'>
              {node.evidence}
            </blockquote>
          </div>
        )}
        {node.aliases.length > 0 && (
          <div>
            <div className='type-ui-eyebrow mb-1.5 text-ink-4'>Aliases</div>
            <div className='flex flex-wrap gap-1.5'>
              {node.aliases.map(alias => (
                <Badge key={alias} tone='neutral'>
                  {alias}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className='flex flex-col gap-3'>
        {node.doc_ids.length > 0 && (
          <div>
            <div className='type-ui-eyebrow mb-1.5 text-ink-4'>
              Documents ({node.doc_ids.length})
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {node.doc_ids.slice(0, 8).map(doc => (
                <Badge key={doc} tone='neutral'>
                  {doc}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {node.page_ids.length > 0 && (
          <div>
            <div className='type-ui-eyebrow mb-1.5 text-ink-4'>Pages ({node.page_ids.length})</div>
            <ul className='flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-ink-2'>
              {node.page_ids.slice(0, 12).map(page => (
                <li key={page}>{page}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
