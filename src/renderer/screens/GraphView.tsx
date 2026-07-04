// Wiki graph view: renders concepts as a force-directed graph (nodes) with
// their cross-references as edges. Uses react-force-graph-2d (canvas) so it
// scales to thousands of concepts. Clicking a node opens the concept in the
// browser view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { browserFolderAtom, browserModeAtom, selectedFileAtom } from "../store.ts";
import type { GraphNode, Result, WikiGraph } from "../../shared/ipc-types.ts";

// Distinct palette for concept types. Concrete hex values because the graph
// renders on a canvas (CSS variables are not resolvable there).
const TYPE_PALETTE = [
  "#4f9cf9", // blue
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
];
const FALLBACK_COLOR = "#9ca3af";

interface GraphScreenNode extends NodeObject {
  id: string;
  title: string;
  type: string;
  tags: readonly string[];
  degree: number;
}

interface GraphScreenLink {
  source: string;
  target: string;
}

/** Last path segment of a conceptId — the filename without `.md`. */
function basename(conceptId: string): string {
  const idx = conceptId.lastIndexOf("/");
  return idx >= 0 ? conceptId.slice(idx + 1) : conceptId;
}

export function GraphView(): JSX.Element {
  const t = useT();
  const setSelected = useSetAtom(selectedFileAtom);
  const setBrowserFolder = useSetAtom(browserFolderAtom);
  const setBrowserMode = useSetAtom(browserModeAtom);

  const [graph, setGraph] = useState<WikiGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<GraphScreenNode, GraphScreenLink> | undefined>(undefined);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

  // Load graph data once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const result: Result<WikiGraph> = await api.getWikiGraph();
      if (cancelled) return;
      if (result.success) {
        setGraph(result.data);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track container size so the canvas fills the pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (): void =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable colour assignment per type (built from the loaded graph).
  const typeColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!graph) return map;
    let i = 0;
    for (const node of graph.nodes) {
      if (!map.has(node.type)) {
        map.set(node.type, TYPE_PALETTE[i % TYPE_PALETTE.length] ?? FALLBACK_COLOR);
        i++;
      }
    }
    return map;
  }, [graph]);

  // Mutable working copy for the library (it mutates nodes/links in place).
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const nodes: GraphScreenNode[] = graph.nodes.map((n: GraphNode) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      tags: n.tags,
      degree: n.degree,
    }));
    const links: GraphScreenLink[] = graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));
    return { nodes, links };
  }, [graph]);

  function openConcept(conceptId: string): void {
    setSelected(`wiki/${conceptId}.md`);
    setBrowserFolder("wiki");
    setBrowserMode("files");
  }

  // Base radius for a leaf; grows slowly with degree (Obsidian-style small
  // dots, hubs only slightly larger).
  const nodeRadius = useCallback((degree: number): number => {
    return 2 + Math.min(Math.sqrt(degree), 5);
  }, []);

  // Custom canvas renderer: small circle + filename label beside it.
  const drawNode = useCallback(
    (node: NodeObject<GraphScreenNode>, ctx: CanvasRenderingContext2D, globalScale: number): void => {
      const n = node as GraphScreenNode;
      const degree = n.degree ?? 0;
      const color = typeColors.get(n.type) ?? FALLBACK_COLOR;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const isHovered = hoveredId === n.id;
      const r = isHovered ? nodeRadius(degree) * 1.6 : nodeRadius(degree);

      // circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (isHovered) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // label: filename next to the circle. Show when zoomed in, for hubs,
      // or for the hovered node (Obsidian reveals labels on demand).
      const showLabel = isHovered || globalScale >= 1.8 || degree >= 4;
      if (!showLabel) return;
      const label = basename(n.id);
      const fontSize = 11 / globalScale;
      const pad = 1.5 / globalScale;
      ctx.font = `${fontSize}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const labelX = x + r + pad;
      const w = ctx.measureText(label).width;
      // background pill for readability over the graph
      ctx.fillStyle = "rgba(28, 28, 30, 0.72)";
      ctx.fillRect(labelX - pad, y - fontSize / 2 - pad, w + pad * 2, fontSize + pad * 2);
      ctx.fillStyle = isHovered ? "#ffffff" : "rgba(225, 225, 227, 0.92)";
      ctx.fillText(label, labelX, y);
    },
    [hoveredId, nodeRadius, typeColors],
  );

  // Hit-detection paint: only the circle area counts for hover/click, so the
  // label does not create a huge invisible target.
  const paintPointerArea = useCallback(
    (node: NodeObject<GraphScreenNode>, color: string, ctx: CanvasRenderingContext2D): void => {
      const n = node as GraphScreenNode;
      const r = nodeRadius(n.degree ?? 0) + 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      ctx.fill();
    },
    [nodeRadius],
  );

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

  return (
    <section className="graph-view">
      <div className="graph-head">
        <div>
          <div className="h-title">{t("graph.title")}</div>
          <div className="h-sub">{t("graph.desc")}</div>
        </div>
        <div className="graph-stats mono">
          <span className="badge accent">{t("graph.nodes", { n: nodeCount })}</span>
          <span className="badge">{t("graph.edges", { n: edgeCount })}</span>
        </div>
        <div className="graph-controls">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => { const m = graphRef.current; if (!m) return; const k = m.zoom(); m.zoom(k * 1.3, 300); }}
            title={t("graph.zoomIn")}
            aria-label={t("graph.zoomIn")}
          >
            +
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => { const m = graphRef.current; if (!m) return; const k = m.zoom(); m.zoom(k / 1.3, 300); }}
            title={t("graph.zoomOut")}
            aria-label={t("graph.zoomOut")}
          >
            −
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => graphRef.current?.zoomToFit?.(400, 40)}
            title={t("graph.fit")}
            aria-label={t("graph.fit")}
          >
            {t("graph.fit")}
          </button>
        </div>
      </div>

      <div className="graph-canvas-wrap" ref={containerRef}>
        {loading && (
          <div className="empty">
            <div className="e-title">{t("graph.loading")}</div>
          </div>
        )}
        {!loading && error && (
          <div className="empty">
            <div className="e-title">{error}</div>
          </div>
        )}
        {!loading && !error && nodeCount === 0 && (
          <div className="empty">
            <div className="e-title">{t("graph.empty")}</div>
          </div>
        )}
        {!loading && !error && nodeCount > 0 && (
          <ForceGraph2D<GraphScreenNode, GraphScreenLink>
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="transparent"
            nodeCanvasObject={drawNode}
            nodeCanvasObjectMode={() => "replace"}
            nodePointerAreaPaint={paintPointerArea}
            nodeLabel={(node: NodeObject<GraphScreenNode>) => {
              const n = node as GraphScreenNode;
              return `${n.title} · ${n.type} · ${n.degree}`;
            }}
            linkColor={() => "rgba(150, 152, 154, 0.6)"}
            linkWidth={1.2}
            linkDirectionalArrowLength={0}
            cooldownTicks={120}
            onNodeClick={(node: NodeObject<GraphScreenNode>) => {
              const n = node as GraphScreenNode;
              if (typeof n.id === "string") openConcept(n.id);
            }}
            onNodeHover={(node: NodeObject<GraphScreenNode> | null) => {
              setHoveredId(node ? (node as GraphScreenNode).id ?? null : null);
            }}
            ref={graphRef}
          />
        )}
      </div>

      {typeColors.size > 0 && (
        <div className="graph-legend">
          <div className="side-title">{t("graph.legend")}</div>
          <div className="legend-list">
            {[...typeColors.entries()].map(([type, color]) => (
              <span key={type} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />
                {type}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}