export type BC = "periodic" | "dirichlet" | "neumann";

export type Cmap = "ember" | "ink" | "tide" | "signed";

export type ParamDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  help?: string;
};

export type ProblemMeta = {
  id: string;
  group: string;
  name: string;
  blurb: string;
  equation: string;
  scheme: string;
  dim: 1 | 2;
};

export type Stats = {
  t: number;
  min: number;
  max: number;
  mean: number;
  l2: number;
  badge: "stable" | "tight" | "unstable" | "blown";
  badgeText: string;
  extra?: string;
};

export type ProbeRow = { label: string; value: string };

export type LayoutBox = { x: number; y: number; w: number; h: number };

export interface Sim {
  id: string;
  n: number;
  dim: 1 | 2;
  cmap: Cmap;
  /** When true, colormap is centered on zero even if the frame is one-sided. */
  forceSigned: boolean;
  frame: Float32Array;
  /** Optional 1D comparison curve, length n. */
  exact: Float32Array | null;
  /** Optional 1D guide (potential, etc.), length n. Drawn unscaled in its own ink. */
  guide: Float32Array | null;
  film: Float32Array | null;
  filmH: number;
  filmRow: number;
  filmCount: number;
  time: number;
  blown: boolean;
  controls: ParamDef[];
  values: Record<string, number>;
  views: { id: string; label: string }[];
  view: string;
  /** Fixed display window. Null = autoscale from the frame. */
  colorWindow: { min: number; max: number } | null;
  reset(): void;
  step(times: number): void;
  setParam(key: string, value: number): void;
  setView(id: string): void;
  paint(nx: number, ny: number, dx: number, dy: number, polarity: number): void;
  probe(nx: number, ny: number): ProbeRow[];
  stats(): Stats;
  notes: string[];
  overlay?(
    ctx: CanvasRenderingContext2D,
    field: LayoutBox,
    dpr: number,
  ): void;
}
