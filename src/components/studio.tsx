import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { legendGradient, paintField, paintFilm } from "@/lib/pde/draw";
import { fmt, PROBLEMS, createSim } from "@/lib/pde/sims";
import { SCRIPT_EXAMPLES, ScriptError } from "@/lib/pde/script";
import type { ProbeRow, Sim, Stats } from "@/lib/pde/types";

const STORAGE_KEY = "pder2";

export function Studio() {
  const [problemId, setProblemId] = useState("decay");
  const [script, setScript] = useState(SCRIPT_EXAMPLES[0].source);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [stat, setStat] = useState<Stats | null>(null);
  const [probe, setProbe] = useState<ProbeRow[]>([]);
  const [rev, setRev] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saveReady, setSaveReady] = useState(false);

  const simRef = useRef<Sim | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(2);
  const scriptRef = useRef(script);
  const problemRef = useRef(problemId);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const filmRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  scriptRef.current = script;
  problemRef.current = problemId;

  function draw() {
    const sim = simRef.current;
    const field = fieldRef.current;
    const film = filmRef.current;
    if (!sim || !field || !film) return;
    paintField(field, sim);
    paintFilm(film, sim);
  }

  function boot(id: string, src: string) {
    try {
      const sim = createSim(id, src);
      simRef.current = sim;
      setError(null);
      setStat(sim.stats());
      setProbe([]);
      setRev((n) => n + 1);
      requestAnimationFrame(draw);
    } catch (err) {
      const message = err instanceof ScriptError || err instanceof Error ? err.message : "Could not start that bench.";
      setError(message);
    }
  }

  useEffect(() => {
    let id = "decay";
    let src = SCRIPT_EXAMPLES[0].source;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { id?: string; script?: string };
        if (saved.id && PROBLEMS.some((p) => p.id === saved.id)) id = saved.id;
        if (typeof saved.script === "string" && saved.script.trim()) src = saved.script;
      }
    } catch {
      /* ignore broken storage */
    }
    setProblemId(id);
    setScript(src);
    boot(id, src);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    playingRef.current = !reduce;
    setPlaying(!reduce);
    setSaveReady(true);
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const sim = simRef.current;
      if (!sim) return;
      if (playingRef.current && !sim.blown) sim.step(speedRef.current);
      const field = fieldRef.current;
      const film = filmRef.current;
      if (field) paintField(field, sim);
      if (film) paintFilm(film, sim);
      if (now - last > 180) {
        last = now;
        const next = sim.stats();
        setStat(next);
        if (sim.blown && playingRef.current) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // Mount once: the animation loop reads refs, not React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!saveReady) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: problemId, script }));
    } catch {
      /* private mode */
    }
  }, [problemId, script, saveReady]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "r" || event.key === "R") {
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    const next = !playingRef.current;
    if (next && simRef.current?.blown) simRef.current.reset();
    playingRef.current = next;
    setPlaying(next);
  }

  function reset() {
    const sim = simRef.current;
    if (!sim) return;
    sim.reset();
    setStat(sim.stats());
    setRev((n) => n + 1);
    draw();
  }

  function stepOnce() {
    const sim = simRef.current;
    if (!sim) return;
    sim.step(1);
    setStat(sim.stats());
    draw();
  }

  function choose(id: string) {
    setProblemId(id);
    boot(id, scriptRef.current);
  }

  function runScript() {
    setProblemId("script");
    boot("script", scriptRef.current);
  }

  const meta = PROBLEMS.find((p) => p.id === problemId) ?? PROBLEMS[0];
  const sim = simRef.current;
  const values = sim?.values ?? {};
  const controls = sim?.controls ?? [];
  const views = sim?.views ?? [];
  const notes = sim?.notes ?? [];
  const legend = sim ? legendGradient(sim) : "linear-gradient(90deg, #101614, #e08a45)";

  function paintAt(clientX: number, clientY: number, dx: number, dy: number, shift: boolean) {
    const canvas = fieldRef.current;
    const live = simRef.current;
    if (!canvas || !live) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    live.paint(nx, ny, dx / rect.width, dy / rect.height, shift ? -1 : 1);
    setProbe(live.probe(nx, ny));
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-line px-4 py-3 sm:px-6">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-3xl leading-none text-fg">PDER</h1>
            <span className="font-mono text-sm text-copper">2.0</span>
          </div>
          <p className="mt-1 text-sm text-muted">Partial Differential Equations Resource</p>
        </div>
        <p className="hidden max-w-xs text-right text-xs leading-5 text-faint sm:block">
          Step the equation. Touch the field.
          <br />
          Space plays. R resets.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-12">
        <aside className="border-b border-line lg:col-span-3 lg:max-h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
          <label className="block px-4 py-3 lg:hidden">
            <span className="text-xs tracking-wide text-faint uppercase">Bench</span>
            <select
              className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-3 text-fg"
              value={problemId}
              onChange={(event) => choose(event.target.value)}
            >
              {PROBLEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <nav className="hidden py-3 lg:block">
            {groupProblems().map(([group, items]) => (
              <div key={group} className="mb-3">
                <p className="px-4 pb-1 text-xs tracking-wide text-faint uppercase">{group}</p>
                {items.map((item) => {
                  const active = item.id === problemId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => choose(item.id)}
                      className={
                        active
                          ? "block w-full border-l-2 border-copper bg-surface px-4 py-2 text-left text-sm text-fg"
                          : "block w-full border-l-2 border-transparent px-4 py-2 text-left text-sm text-muted hover:bg-bg-raised hover:text-fg"
                      }
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="px-4 py-4 lg:col-span-6 lg:px-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-fg">{meta.name}</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted">{meta.blurb}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-line bg-bg-raised">
            <canvas
              ref={filmRef}
              className="h-24 w-full"
              aria-label="Spacetime strip of the field"
            />
            <canvas
              ref={fieldRef}
              className={
                meta.dim === 1
                  ? "aspect-video w-full touch-none"
                  : "aspect-square w-full touch-none"
              }
              aria-label="Field"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = { x: event.clientX, y: event.clientY };
                paintAt(event.clientX, event.clientY, 0, 0, event.shiftKey);
              }}
              onPointerMove={(event) => {
                const canvas = fieldRef.current;
                const live = simRef.current;
                if (canvas && live) {
                  const rect = canvas.getBoundingClientRect();
                  const nx = (event.clientX - rect.left) / rect.width;
                  const ny = (event.clientY - rect.top) / rect.height;
                  if (nx >= 0 && ny >= 0 && nx <= 1 && ny <= 1) setProbe(live.probe(nx, ny));
                }
                if (!pointer.current || event.buttons === 0) return;
                const dx = event.clientX - pointer.current.x;
                const dy = event.clientY - pointer.current.y;
                pointer.current = { x: event.clientX, y: event.clientY };
                paintAt(event.clientX, event.clientY, dx, dy, event.shiftKey);
              }}
              onPointerUp={() => {
                pointer.current = null;
              }}
            />
          </div>

          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 rounded-sm" style={{ background: legend }} />
            <span className="font-mono text-xs text-faint">
              {stat ? `${fmt(stat.min)} … ${fmt(stat.max)}` : ""}
            </span>
          </div>
          <p className="mt-1 text-xs text-faint">
            {meta.dim === 1 ? "Time runs down the strip. The trace is the field now." : "The strip is the midline as time runs downward. Drag to paint."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center gap-2 rounded-md bg-copper px-4 py-3 text-sm font-medium text-copper-ink"
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={stepOnce}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg"
            >
              <StepForward size={16} />
              Step
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg"
            >
              <RotateCcw size={16} />
              Reset
            </button>
            <div className="ml-auto flex items-center gap-1">
              <span className="mr-1 text-xs text-faint">Speed</span>
              {[1, 2, 4, 8].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    speedRef.current = value;
                    setSpeed(value);
                  }}
                  className={
                    speed === value
                      ? "rounded-sm bg-surface-2 px-3 py-2 font-mono text-xs text-copper"
                      : "rounded-sm px-3 py-2 font-mono text-xs text-muted"
                  }
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-md border border-line bg-surface px-4 py-3">
            <p className="font-mono text-sm leading-6 text-copper">{meta.equation}</p>
            <p className="mt-1 text-xs text-muted">{meta.scheme}</p>
          </div>

          {problemId === "script" && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap gap-2">
                {SCRIPT_EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    className="rounded-sm border border-line px-3 py-2 text-xs text-muted hover:text-fg"
                    onClick={() => {
                      setScript(example.source);
                      scriptRef.current = example.source;
                      boot("script", example.source);
                    }}
                  >
                    {example.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded-sm border border-line px-3 py-2 text-xs text-muted hover:text-fg"
                  onClick={() => {
                    void navigator.clipboard.writeText(script).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                value={script}
                spellCheck={false}
                onChange={(event) => setScript(event.target.value)}
                className="min-h-64 w-full rounded-md border border-line bg-bg px-3 py-3 font-mono text-sm leading-6 text-fg"
                aria-label="Equation script"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-faint">
                  field, param, ic, bc, and either u' = … or the 2015 assignment style.
                </p>
                <button
                  type="button"
                  onClick={runScript}
                  className="rounded-md bg-copper px-4 py-3 text-sm font-medium text-copper-ink"
                >
                  Run script
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-bad bg-surface px-3 py-3 text-sm text-bad">{error}</p>
          )}
        </main>

        <aside className="border-t border-line px-4 py-4 lg:col-span-3 lg:max-h-screen lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-fg">Readout</h3>
            <Badge stat={stat} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Readout label="t" value={stat ? fmt(stat.t) : "—"} />
            <Readout label="mean" value={stat ? fmt(stat.mean) : "—"} />
            <Readout label="L2" value={stat ? fmt(stat.l2) : "—"} />
            <Readout label="max" value={stat ? fmt(stat.max) : "—"} />
          </dl>
          {stat?.extra && <p className="mt-2 font-mono text-xs leading-5 text-muted">{stat.extra}</p>}
          {stat?.badgeText && <p className="mt-1 text-xs text-faint">{stat.badgeText}</p>}

          {probe.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs tracking-wide text-faint uppercase">Pointer</p>
              <ul className="mt-2 space-y-1">
                {probe.map((row) => (
                  <li key={row.label} className="flex justify-between font-mono text-xs">
                    <span className="text-muted">{row.label}</span>
                    <span className="text-fg">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {views.length > 1 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs tracking-wide text-faint uppercase">Field</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {views.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => {
                      simRef.current?.setView(view.id);
                      setRev((n) => n + 1);
                      draw();
                    }}
                    className={
                      sim?.view === view.id
                        ? "rounded-sm bg-copper px-3 py-2 text-xs text-copper-ink"
                        : "rounded-sm border border-line px-3 py-2 text-xs text-muted"
                    }
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-4 border-t border-line pt-4">
            {controls.map((control) => (
              <label key={control.key} className="block">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg">{control.label}</span>
                  <span className="font-mono text-xs text-copper">{fmt(values[control.key] ?? control.value)}</span>
                </span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={values[control.key] ?? control.value}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    simRef.current?.setParam(control.key, value);
                    setRev((n) => n + 1);
                  }}
                  className="mt-1 w-full"
                />
                {control.help && <span className="mt-1 block text-xs text-faint">{control.help}</span>}
              </label>
            ))}
          </div>

          {notes.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-line pt-4">
              {notes.map((note) => (
                <li key={note} className="text-xs leading-5 text-muted">
                  {note}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-6 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm text-fg">Where this came from</summary>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
              <p>
                PDER 1.0 was your 2015 computer-engineering senior design at Tennessee, with Joey Allen, Alex
                Kotzman, and Wilson Parker. Advisors Doug Birdwell and Bruce MacLennan. It was a FLTK and MathGL
                desktop lab: a <span className="font-mono text-copper">.pde</span> file declared scalar and vector
                fields, constants became sliders, and an expression parser stepped them on a 100³ grid.
              </p>
              <p>
                The operators were real — gradient, curl, divergence, and a laplacian built as div(grad) — and the
                user's manual still ends at “under construction.” The checked-in initial file is essentially
                empty. The demo equation is diffusion with linear decay.
              </p>
              <p>
                2.0 keeps that language, including the original wide <span className="font-mono">laplac()</span>{" "}
                stencil, and puts stable schemes next to it: Fourier heat, leapfrog waves, a Burgers shock,
                Gray–Scott, Barkley spirals, a split-step packet, SOR electrostatics, and Stam's stable fluids.
                Paint replaces the initial-value text file.
              </p>
              <p className="text-xs text-faint">
                Scripts stay in this browser. Nothing is uploaded.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function groupProblems() {
  const groups: [string, typeof PROBLEMS][] = [];
  for (const problem of PROBLEMS) {
    const last = groups[groups.length - 1];
    if (!last || last[0] !== problem.group) groups.push([problem.group, [problem]]);
    else last[1].push(problem);
  }
  return groups;
}

function Badge({ stat }: { stat: Stats | null }) {
  const kind = stat?.badge ?? "stable";
  const cls =
    kind === "blown" || kind === "unstable"
      ? "text-bad"
      : kind === "tight"
        ? "text-copper"
        : "text-good";
  return <span className={`font-mono text-xs ${cls}`}>{stat?.badge ?? "—"}</span>;
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="font-mono text-sm text-fg">{value}</dd>
    </div>
  );
}
