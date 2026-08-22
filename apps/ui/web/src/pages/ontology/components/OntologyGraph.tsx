import { Suspense, useCallback, useMemo, useRef, type ComponentType } from 'react';
import { Spinner } from '../../../components/ui/spinner';
import { lazyWithRetry } from '../../../lib/lazyWithRetry';
import type { GraphData } from '../types/ontology';
import type { Palette } from '../utils/graphColors';

// Lazy-load so d3-force + the canvas renderer stay out of the initial bundle. The
// library's generics are permissive; cast to a plain component to avoid prop friction.
// lazyWithRetry reloads once if the chunk fails to load after a redeploy.
const ForceGraph2D = lazyWithRetry(
  () =>
    import('react-force-graph-2d') as unknown as Promise<{
      default: ComponentType<Record<string, unknown>>;
    }>
);

interface OntologyGraphProps {
  data: GraphData;
  width: number;
  height: number;
  palette: Palette;
  typeColors: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Interactive force-directed graph. Nodes are colored by type (canvas can't use
 * Tailwind, so colors come from the token palette), sized by page frequency, and
 * shaped by role: identifier nodes (the cross-document bridges) carry a ring, and
 * observation nodes draw as diamonds, so the three roles read apart at a glance.
 * Labels draw only when zoomed in, and the whole thing zooms-to-fit once the
 * simulation settles. Re-rendering with a new palette repaints via the canvas
 * accessors without re-simulating (data reference is stable).
 */
export default function OntologyGraph({
  data,
  width,
  height,
  palette,
  typeColors,
  selectedId,
  onSelect,
}: OntologyGraphProps) {
  const fgRef = useRef<{ zoomToFit?: (ms: number, px: number) => void }>(null);

  // Seed nodes in per-type clusters on a ring before the sim runs, so entities of a
  // kind settle together. Keyed on `data` only (not the palette), so a light/dark
  // flip repaints via the accessors without re-seeding or re-simulating.
  const seededData = useMemo(() => {
    const types: string[] = [];
    for (const node of data.nodes) {
      const type = node.type ?? '';
      if (!types.includes(type)) types.push(type);
    }
    const ring = 150;
    const centers = new Map<string, { x: number; y: number }>();
    types.forEach((type, i) => {
      const angle = (i / Math.max(types.length, 1)) * 2 * Math.PI;
      centers.set(type, { x: ring * Math.cos(angle), y: ring * Math.sin(angle) });
    });
    const jitter = 24;
    const nodes = data.nodes.map((node, i) => {
      const center = centers.get(node.type ?? '') ?? { x: 0, y: 0 };
      // Deterministic per-node offset (stable across re-renders, no random jump).
      return { ...node, x: center.x + Math.cos(i) * jitter, y: center.y + Math.sin(i) * jitter };
    });
    return { nodes, links: data.links.map(link => ({ ...link })) };
  }, [data]);

  const colorFor = useCallback(
    (node: { type?: string }) => typeColors.get(node.type ?? '') || palette.muted,
    [typeColors, palette]
  );

  const radiusFor = useCallback((node: Record<string, unknown>) => {
    const pageDf = (node.page_df as number) || 1;
    return 4 + Math.min(pageDf, 10) * 0.5;
  }, []);

  const paintNode = useCallback(
    (node: Record<string, unknown>, ctx: CanvasRenderingContext2D, scale: number) => {
      const x = node.x as number;
      const y = node.y as number;
      const radius = radiusFor(node);

      ctx.globalAlpha = node.eligible === false ? 0.45 : 1;

      ctx.fillStyle = colorFor(node as { type?: string });
      ctx.beginPath();
      if (node.role === 'observation') {
        // Observations draw as a diamond (time-anchored events read apart from entities).
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius, y);
        ctx.closePath();
      } else {
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
      }
      ctx.fill();

      // Identifier nodes are the bridges — always ring them so they read as joins.
      if (node.role === 'identifier') {
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = palette.ink;
        ctx.beginPath();
        ctx.arc(x, y, radius + 1.5 / scale, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Dashed and set outside the fill, so it reads apart from the identifier
      // ring: a selected identifier must not look like an ordinary one.
      if (node.id === selectedId) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = palette.ink;
        ctx.setLineDash([3 / scale, 2.5 / scale]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5 / scale, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;

      if (scale > 1.4) {
        const label = (node.name as string) || (node.id as string);
        ctx.font = `600 ${11 / scale}px Archivo, sans-serif`;
        ctx.fillStyle = palette.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + radius + 2 / scale);
      }
    },
    [colorFor, palette, radiusFor, selectedId]
  );

  const paintPointerArea = useCallback(
    (
      node: Record<string, unknown>,
      color: string,
      ctx: CanvasRenderingContext2D,
      scale: number
    ) => {
      const drawRadius = radiusFor(node);
      // Keep small nodes clickable: at least ~12px on screen, regardless of zoom.
      const hitRadius = Math.max(drawRadius, 12 / scale);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x as number, node.y as number, hitRadius, 0, 2 * Math.PI);
      ctx.fill();
    },
    [radiusFor]
  );

  return (
    <Suspense
      fallback={
        <div className='flex h-full items-center justify-center'>
          <Spinner />
        </div>
      }
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={seededData}
        width={width}
        height={height}
        backgroundColor='rgba(0,0,0,0)'
        nodeRelSize={5}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        linkColor={() => palette.line}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkWidth={0.5}
        cooldownTicks={100}
        onNodeClick={(node: Record<string, unknown>) => onSelect(node.id as string)}
        onBackgroundClick={() => onSelect(null)}
        onEngineStop={() => fgRef.current?.zoomToFit?.(400, 40)}
      />
    </Suspense>
  );
}
