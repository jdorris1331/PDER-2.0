import { addGaussian1, addGaussian2, fft, fill, hash01, isBlown, ix, lap1, lap5, makeStats, scan } from "@/lib/pde/field";
import { applyOp, compileScript, noiseAt, ScriptError } from "@/lib/pde/script";
import type { Cmap, ParamDef, ProblemMeta, Sim } from "@/lib/pde/types";

const FILM = 84;

export const PROBLEMS: ProblemMeta[] = [
  {
    id: "decay",
    group: "The 2015 lab",
    name: "Diffusion–decay",
    blurb:
      "The scalar system in problem3.pde. Two hot spots share one equation, so you can watch the stencil your senior-design lab stepped — without a 100³ grid.",
    equation: "∂u/∂t = k⁻¹ ∇²u − u/τ",
    scheme: "Explicit Euler · five-point Laplacian",
    dim: 2,
  },
  {
    id: "heat1",
    group: "Heat",
    name: "Heat equation",
    blurb:
      "A sine profile on a cold rod. The dashed curve is the Fourier solution. Paint the rod and the exact curve steps aside — the scheme no longer has that initial condition.",
    equation: "∂u/∂t = κ ∂²u/∂x²",
    scheme: "FTCS · compared with e^{−κπ²t} sin(πx)",
    dim: 1,
  },
  {
    id: "plate",
    group: "Heat",
    name: "Hot plate",
    blurb: "Dirichlet edges stay cold. Paint heat and watch it soak toward the boundary.",
    equation: "∂u/∂t = κ ∇²u",
    scheme: "FTCS · cold boundary",
    dim: 2,
  },
  {
    id: "string",
    group: "Waves",
    name: "Vibrating string",
    blurb: "Ends pinned. Click to pluck. Lower the tension parameter and the pitch drops.",
    equation: "∂²u/∂t² = c² ∂²u/∂x²",
    scheme: "Leapfrog · CFL-limited",
    dim: 1,
  },
  {
    id: "drum",
    group: "Waves",
    name: "Drumhead",
    blurb: "A square membrane. Tap to displace it. A little damping keeps it from ringing forever.",
    equation: "∂²u/∂t² = c² ∇²u − γ ∂u/∂t",
    scheme: "Leapfrog · pinned rim",
    dim: 2,
  },
  {
    id: "burgers",
    group: "Nonlinear",
    name: "Burgers shock",
    blurb:
      "The simplest equation that makes a shock. The sine wave steepens, then viscosity sets the front thickness.",
    equation: "∂u/∂t + u ∂u/∂x = ν ∂²u/∂x²",
    scheme: "Upwind advection · FTCS diffusion",
    dim: 1,
  },
  {
    id: "allen",
    group: "Nonlinear",
    name: "Allen–Cahn",
    blurb: "Phase separation. Random seeds coarsen into domains of +1 and −1. Interface width is ε.",
    equation: "∂u/∂t = ε ∇²u + u − u³",
    scheme: "Explicit Euler · periodic",
    dim: 2,
  },
  {
    id: "gray",
    group: "Nonlinear",
    name: "Gray–Scott",
    blurb:
      "The pattern-forming cousin of the 2015 two-field model. Drag the feed and kill rates — mitosis, coral, spots, and worms are nearby.",
    equation: "∂u/∂t = Du∇²u − uv² + F(1−u)    ∂v/∂t = Dv∇²v + uv² − (F+k)v",
    scheme: "Explicit Euler · periodic · grid Laplacian",
    dim: 2,
  },
  {
    id: "barkley",
    group: "Nonlinear",
    name: "Excitable pulse",
    blurb:
      "Barkley’s model of a nerve membrane. A broken front curls into a spiral. ε is how stiff the upstroke is.",
    equation: "∂u/∂t = ε⁻¹ u(1−u)(u − (v+b)/a) + ∇²u    ∂v/∂t = u − v",
    scheme: "Explicit Euler · periodic",
    dim: 2,
  },
  {
    id: "packet",
    group: "Quantum",
    name: "Barrier packet",
    blurb:
      "A Gaussian wave packet meets a rectangular barrier. The strip above is |ψ|² through time. Raise the barrier through the packet’s energy and watch it split.",
    equation: "i ∂ψ/∂t = −½ ∂²ψ/∂x² + Vψ",
    scheme: "Split-step Fourier · periodic box",
    dim: 1,
  },
  {
    id: "poisson",
    group: "Fields",
    name: "Electrostatics",
    blurb:
      "Poisson’s equation in a grounded box. Click to drop charge. The field relaxes by SOR — the same div-grad idea as PDER’s laplacian, solved instead of stepped.",
    equation: "∇²φ = −ρ",
    scheme: "Successive over-relaxation",
    dim: 2,
  },
  {
    id: "ink",
    group: "Fields",
    name: "Ink in water",
    blurb:
      "Two-dimensional Navier–Stokes, Jos Stam’s stable-fluids scheme. Drag to stir. Viscosity and dye diffusion are the sliders the 2015 vector field never quite got.",
    equation: "∂ₜu + (u·∇)u = −∇p + ν∇²u    ∇·u = 0",
    scheme: "Semi-Lagrangian advection · pressure projection",
    dim: 2,
  },
  {
    id: "script",
    group: "Your equations",
    name: "Script bench",
    blurb:
      "Paste a PDER 1.0 .pde file, or write 2.0 derivative form. lap() is the five-point stencil. laplac() is the original wide div(grad).",
    equation: "u' = …   or   u = u + …",
    scheme: "Explicit Euler on a 2D grid",
    dim: 2,
  },
];

function controls(defs: ParamDef[], values: Record<string, number>) {
  for (const d of defs) values[d.key] = d.value;
  return defs;
}

function filmState(n: number) {
  return {
    film: new Float32Array(FILM * n),
    filmH: FILM,
    filmRow: 0,
    filmCount: 0,
  };
}

function pushFilm(sim: Sim, src: Float32Array) {
  if (!sim.film) return;
  const n = sim.n;
  const dest = sim.filmRow * n;
  if (sim.dim === 1) {
    for (let i = 0; i < n; i++) sim.film[dest + i] = src[i];
  } else {
    const j = (n >> 1) * n;
    for (let i = 0; i < n; i++) sim.film[dest + i] = src[j + i];
  }
  sim.filmRow = (sim.filmRow + 1) % sim.filmH;
  sim.filmCount = Math.min(sim.filmH, sim.filmCount + 1);
}

function shell(partial: Pick<Sim, "id" | "n" | "dim" | "cmap"> & { forceSigned?: boolean }): Sim {
  const sim = {
    forceSigned: false,
    frame: new Float32Array(partial.dim === 1 ? partial.n : partial.n * partial.n),
    exact: null,
    guide: null,
    time: 0,
    blown: false,
    controls: [] as ParamDef[],
    values: {} as Record<string, number>,
    views: [{ id: "u", label: "u" }],
    view: "u",
    colorWindow: null,
    notes: [] as string[],
    ...filmState(partial.n),
    ...partial,
    reset() {},
    step() {},
    setParam(key: string, value: number) {
      this.values[key] = value;
    },
    setView(id: string) {
      this.view = id;
    },
    paint() {},
    probe() {
      return [];
    },
    stats() {
      return makeStats(this.frame, this.time, this.blown ? "blown" : "stable", this.blown ? "blew up" : "stable");
    },
  } as Sim;
  return sim;
}

export function createSim(id: string, script = ""): Sim {
  switch (id) {
    case "decay":
      return makeDecay();
    case "heat1":
      return makeHeat1();
    case "plate":
      return makePlate();
    case "string":
      return makeString();
    case "drum":
      return makeDrum();
    case "burgers":
      return makeBurgers();
    case "allen":
      return makeAllen();
    case "gray":
      return makeGray();
    case "barkley":
      return makeBarkley();
    case "packet":
      return makePacket();
    case "poisson":
      return makePoisson();
    case "ink":
      return makeInk();
    case "script":
      return makeScript(script);
    default:
      return makeDecay();
  }
}

function makeDecay(): Sim {
  const n = 120;
  const sim = shell({ id: "decay", n, dim: 2, cmap: "ember" });
  const u = new Float32Array(n * n);
  const v = new Float32Array(n * n);
  const lu = new Float32Array(n * n);
  const lv = new Float32Array(n * n);
  sim.views = [
    { id: "u", label: "box1" },
    { id: "v", label: "box2" },
  ];
  sim.controls = controls(
    [
      { key: "k", label: "k  diffusion time", min: 0.4, max: 8, step: 0.05, value: 2, help: "Larger k spreads more slowly." },
      { key: "tau", label: "τ  decay time", min: 1, max: 40, step: 0.1, value: 16 },
      { key: "dt", label: "Δt", min: 0.02, max: 0.35, step: 0.01, value: 0.18 },
    ],
    sim.values,
  );
  const seed = () => {
    fill(u, 0);
    fill(v, 0);
    addGaussian2(u, n, 0.38, 0.52, 0.07, 1);
    addGaussian2(v, n, 0.64, 0.46, 0.05, 1);
    addGaussian2(u, n, 0.5, 0.72, 0.03, 0.6);
  };
  const show = () => {
    sim.frame = sim.view === "v" ? v : u;
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    seed();
    show();
  };
  sim.setView = (id) => {
    sim.view = id;
    show();
  };
  sim.step = (times) => {
    const k = Math.max(0.05, sim.values.k);
    const tau = Math.max(0.05, sim.values.tau);
    const dt = sim.values.dt;
    const diff = dt / k;
    if (diff > 0.24) sim.blown = false;
    for (let s = 0; s < times; s++) {
      lap5(u, lu, n, "dirichlet");
      lap5(v, lv, n, "dirichlet");
      for (let i = 0; i < u.length; i++) {
        u[i] += diff * lu[i] - (dt / tau) * u[i];
        v[i] += diff * lv[i] - (dt / tau) * v[i];
      }
      sim.time += dt;
      if (isBlown(u) || diff > 0.25) {
        sim.blown = diff > 0.25 || isBlown(u);
        break;
      }
    }
    show();
    pushFilm(sim, sim.frame);
  };
  sim.paint = (nx, ny, _dx, _dy, polarity) => {
    const target = sim.view === "v" ? v : u;
    addGaussian2(target, n, nx, ny, 0.035, 0.85 * (polarity || 1));
    show();
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    const id = ix(n, i, j);
    return [
      { label: "box1", value: fmt(u[id]) },
      { label: "box2", value: fmt(v[id]) },
    ];
  };
  sim.stats = () => {
    const diff = sim.values.dt / Math.max(0.05, sim.values.k);
    const tight = diff > 0.2;
    return makeStats(
      sim.frame,
      sim.time,
      sim.blown ? "blown" : tight ? "tight" : "stable",
      sim.blown ? "unstable — lower Δt or raise k" : tight ? "near the FTCS limit" : "FTCS stable",
      "r = 4 Δt / k = " + fmt(4 * diff),
    );
  };
  sim.notes = [
    "problem3.pde evolved box1 and box2 with the same diffusion–decay update, plus a vector that only did vect = vect + 0.01. The vector wasn’t coupled, so it isn’t on this bench.",
  ];
  sim.reset();
  return sim;
}

function makeHeat1(): Sim {
  const n = 240;
  const sim = shell({ id: "heat1", n, dim: 1, cmap: "ember" });
  const u = sim.frame;
  const lu = new Float32Array(n);
  const exact = new Float32Array(n);
  sim.exact = exact;
  let pure = true;
  sim.controls = controls(
    [
      { key: "kappa", label: "κ", min: 0.05, max: 2, step: 0.01, value: 0.4, help: "Diffusivity on the unit interval." },
    ],
    sim.values,
  );
  const writeExact = () => {
    const k = sim.values.kappa;
    const decay = Math.exp(-Math.PI * Math.PI * k * sim.time);
    for (let i = 0; i < n; i++) exact[i] = Math.sin((Math.PI * i) / (n - 1)) * decay;
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    pure = true;
    sim.exact = exact;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    for (let i = 0; i < n; i++) u[i] = Math.sin((Math.PI * i) / (n - 1));
    u[0] = 0;
    u[n - 1] = 0;
    writeExact();
  };
  sim.step = (times) => {
    const kappa = sim.values.kappa;
    const h = 1 / (n - 1);
    const dt = (0.2 * h * h) / Math.max(kappa, 1e-4);
    const sub = Math.max(1, Math.round(times * 12));
    for (let s = 0; s < sub; s++) {
      lap1(u, lu, n, "dirichlet");
      const a = (kappa * dt) / (h * h);
      for (let i = 1; i < n - 1; i++) u[i] += a * lu[i];
      u[0] = 0;
      u[n - 1] = 0;
      sim.time += dt;
    }
    if (pure) writeExact();
    else sim.exact = null;
    pushFilm(sim, u);
    if (isBlown(u)) sim.blown = true;
  };
  sim.paint = (nx) => {
    pure = false;
    sim.exact = null;
    addGaussian1(u, n, nx, 0.035, 0.8);
  };
  sim.probe = (nx) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const rows = [{ label: "u", value: fmt(u[i]) }];
    if (pure) rows.push({ label: "exact", value: fmt(exact[i]) });
    return rows;
  };
  sim.stats = () => {
    let err = 0;
    if (pure) {
      for (let i = 0; i < n; i++) {
        const d = u[i] - exact[i];
        err += d * d;
      }
      err = Math.sqrt(err / n);
    }
    return makeStats(u, sim.time, "stable", "FTCS r = 0.20", pure ? "L2 error " + fmt(err) : "painted — exact hidden");
  };
  sim.reset();
  return sim;
}

function makePlate(): Sim {
  const n = 120;
  const sim = shell({ id: "plate", n, dim: 2, cmap: "ember" });
  const u = sim.frame;
  const lu = new Float32Array(n * n);
  sim.controls = controls(
    [{ key: "kappa", label: "κ", min: 0.04, max: 0.22, step: 0.005, value: 0.14 }],
    sim.values,
  );
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    fill(u, 0);
    addGaussian2(u, n, 0.35, 0.4, 0.06, 1);
    addGaussian2(u, n, 0.62, 0.58, 0.04, 0.75);
  };
  sim.step = (times) => {
    const kappa = sim.values.kappa;
    const sub = 4 * times;
    for (let s = 0; s < sub; s++) {
      lap5(u, lu, n, "dirichlet");
      for (let i = 0; i < u.length; i++) u[i] += kappa * lu[i];
      sim.time += 1;
    }
    if (kappa > 0.24 || isBlown(u)) sim.blown = true;
    pushFilm(sim, u);
  };
  sim.paint = (nx, ny, _dx, _dy, polarity) => {
    addGaussian2(u, n, nx, ny, 0.04, 0.9 * (polarity || 1));
  };
  sim.probe = (nx, ny) => sample2(u, n, nx, ny, "u");
  sim.stats = () =>
    makeStats(
      u,
      sim.time,
      sim.values.kappa > 0.22 ? "tight" : "stable",
      sim.values.kappa > 0.22 ? "near the explicit limit" : "FTCS stable",
    );
  sim.reset();
  return sim;
}

function makeString(): Sim {
  const n = 240;
  const sim = shell({ id: "string", n, dim: 1, cmap: "signed", forceSigned: true });
  const u = sim.frame;
  const prev = new Float32Array(n);
  const lu = new Float32Array(n);
  sim.controls = controls(
    [
      { key: "c2", label: "c²  tension", min: 0.05, max: 0.9, step: 0.01, value: 0.35 },
      { key: "damp", label: "damping", min: 0, max: 0.02, step: 0.0005, value: 0.001 },
    ],
    sim.values,
  );
  const pin = () => {
    u[0] = u[n - 1] = prev[0] = prev[n - 1] = 0;
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    fill(u, 0);
    fill(prev, 0);
    addGaussian1(u, n, 0.32, 0.04, 0.8);
    prev.set(u);
    pin();
  };
  return finishString(sim, u, prev, lu, n);
}

function finishString(sim: Sim, u: Float32Array, prev: Float32Array, lu: Float32Array, n: number) {
  const next = new Float32Array(n);
  const pin = () => {
    u[0] = u[n - 1] = prev[0] = prev[n - 1] = next[0] = next[n - 1] = 0;
  };
  sim.step = (times) => {
    const c2 = Math.min(sim.values.c2, 0.98);
    const damp = sim.values.damp;
    for (let s = 0; s < times * 2; s++) {
      lap1(u, lu, n, "dirichlet");
      for (let i = 1; i < n - 1; i++) {
        const vel = u[i] - prev[i];
        next[i] = 2 * u[i] - prev[i] + c2 * lu[i] - damp * vel;
      }
      prev.set(u);
      u.set(next);
      pin();
      sim.time += 1;
    }
    if (isBlown(u)) sim.blown = true;
    pushFilm(sim, u);
  };
  sim.paint = (nx) => {
    addGaussian1(u, n, nx, 0.03, 0.7);
    addGaussian1(prev, n, nx, 0.03, 0.7);
    pin();
  };
  sim.probe = (nx) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    return [{ label: "u", value: fmt(u[i]) }];
  };
  sim.stats = () =>
    makeStats(u, sim.time, sim.values.c2 > 0.9 ? "tight" : "stable", sim.values.c2 > 0.9 ? "near the CFL limit" : "leapfrog CFL ok");
  sim.reset();
  return sim;
}

function makeDrum(): Sim {
  const n = 100;
  const sim = shell({ id: "drum", n, dim: 2, cmap: "signed", forceSigned: true });
  const u = sim.frame;
  const prev = new Float32Array(n * n);
  const next = new Float32Array(n * n);
  const lu = new Float32Array(n * n);
  sim.controls = controls(
    [
      { key: "c2", label: "c²", min: 0.02, max: 0.45, step: 0.005, value: 0.14 },
      { key: "damp", label: "damping", min: 0, max: 0.05, step: 0.001, value: 0.004 },
    ],
    sim.values,
  );
  const pin = (a: Float32Array) => {
    for (let i = 0; i < n; i++) {
      a[i] = 0;
      a[(n - 1) * n + i] = 0;
      a[i * n] = 0;
      a[i * n + (n - 1)] = 0;
    }
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    fill(u, 0);
    addGaussian2(u, n, 0.35, 0.42, 0.05, 1);
    prev.set(u);
    pin(u);
    pin(prev);
  };
  sim.step = (times) => {
    const c2 = Math.min(sim.values.c2, 0.48);
    const damp = sim.values.damp;
    for (let s = 0; s < times; s++) {
      lap5(u, lu, n, "dirichlet");
      for (let i = 0; i < u.length; i++) {
        const vel = u[i] - prev[i];
        next[i] = 2 * u[i] - prev[i] + c2 * lu[i] - damp * vel;
      }
      prev.set(u);
      u.set(next);
      pin(u);
      pin(prev);
      sim.time += 1;
    }
    if (isBlown(u)) sim.blown = true;
    pushFilm(sim, u);
  };
  sim.paint = (nx, ny) => {
    addGaussian2(u, n, nx, ny, 0.04, 0.85);
    addGaussian2(prev, n, nx, ny, 0.04, 0.85);
    pin(u);
    pin(prev);
  };
  sim.probe = (nx, ny) => sample2(u, n, nx, ny, "u");
  sim.stats = () =>
    makeStats(u, sim.time, sim.values.c2 > 0.4 ? "tight" : "stable", sim.values.c2 > 0.4 ? "near the CFL limit" : "leapfrog CFL ok");
  sim.reset();
  return sim;
}

function makeBurgers(): Sim {
  const n = 256;
  const sim = shell({ id: "burgers", n, dim: 1, cmap: "signed", forceSigned: true });
  const u = sim.frame;
  const next = new Float32Array(n);
  sim.controls = controls(
    [
      { key: "nu", label: "ν  viscosity", min: 0.05, max: 1.5, step: 0.01, value: 0.35, help: "Shock thickness grows with viscosity." },
      { key: "dt", label: "Δt", min: 0.02, max: 0.25, step: 0.005, value: 0.12 },
    ],
    sim.values,
  );
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    for (let i = 0; i < n; i++) u[i] = Math.sin((2 * Math.PI * i) / n);
  };
  sim.step = (times) => {
    const nu = sim.values.nu;
    const dt = sim.values.dt;
    for (let s = 0; s < times * 2; s++) {
      for (let i = 0; i < n; i++) {
        const ip = (i + 1) % n;
        const im = (i - 1 + n) % n;
        const ux = u[i] >= 0 ? u[i] - u[im] : u[ip] - u[i];
        const uxx = u[ip] - 2 * u[i] + u[im];
        next[i] = u[i] + dt * (-u[i] * ux + nu * uxx);
      }
      u.set(next);
      sim.time += dt;
    }
    if (isBlown(u) || sim.values.dt * 4 * sim.values.nu > 1.05) sim.blown = isBlown(u);
    pushFilm(sim, u);
  };
  sim.paint = (nx, _ny, _dx, _dy, polarity) => {
    addGaussian1(u, n, nx, 0.03, 0.6 * (polarity || 1));
  };
  sim.probe = (nx) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * n) % n));
    return [{ label: "u", value: fmt(u[i]) }];
  };
  sim.stats = () => {
    let slope = 0;
    for (let i = 0; i < n; i++) slope = Math.max(slope, Math.abs(u[(i + 1) % n] - u[i]));
    const cfl = sim.values.dt * 4 * sim.values.nu;
    return makeStats(
      u,
      sim.time,
      sim.blown ? "blown" : cfl > 0.9 ? "tight" : "stable",
      sim.blown ? "blew up — lower Δt" : cfl > 0.9 ? "diffusion CFL tight" : "upwind + FTCS",
      "max |Δu| " + fmt(slope),
    );
  };
  sim.reset();
  return sim;
}

function makeAllen(): Sim {
  const n = 120;
  const sim = shell({ id: "allen", n, dim: 2, cmap: "signed", forceSigned: true });
  const u = sim.frame;
  const lu = new Float32Array(n * n);
  const next = new Float32Array(n * n);
  sim.controls = controls(
    [
      { key: "eps", label: "ε  interface", min: 0.15, max: 1.4, step: 0.01, value: 0.7 },
      { key: "dt", label: "Δt", min: 0.02, max: 0.2, step: 0.005, value: 0.08 },
    ],
    sim.values,
  );
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    for (let i = 0; i < u.length; i++) u[i] = hash01(i, 3) * 2 - 1;
  };
  sim.step = (times) => {
    const eps = sim.values.eps;
    const dt = sim.values.dt;
    const sub = times * 2;
    for (let s = 0; s < sub; s++) {
      lap5(u, lu, n, "periodic");
      for (let i = 0; i < u.length; i++) {
        const z = u[i];
        next[i] = z + dt * (eps * lu[i] + z - z * z * z);
      }
      u.set(next);
      sim.time += dt;
    }
    if (isBlown(u)) sim.blown = true;
    pushFilm(sim, u);
  };
  sim.paint = (nx, ny, _dx, _dy, polarity) => {
    addGaussian2(u, n, nx, ny, 0.05, polarity >= 0 ? 1.2 : -1.2);
  };
  sim.probe = (nx, ny) => sample2(u, n, nx, ny, "u");
  sim.stats = () => {
    const cfl = sim.values.dt * sim.values.eps * 4;
    return makeStats(u, sim.time, cfl > 1 ? "tight" : "stable", cfl > 1 ? "diffusion CFL tight" : "explicit Euler");
  };
  sim.reset();
  return sim;
}

function makeGray(): Sim {
  const n = 128;
  const sim = shell({ id: "gray", n, dim: 2, cmap: "ink" });
  const u = new Float32Array(n * n);
  const v = new Float32Array(n * n);
  const lu = new Float32Array(n * n);
  const lv = new Float32Array(n * n);
  sim.views = [
    { id: "v", label: "v" },
    { id: "u", label: "u" },
  ];
  sim.view = "v";
  sim.controls = controls(
    [
      { key: "F", label: "F  feed", min: 0.01, max: 0.08, step: 0.0005, value: 0.0545 },
      { key: "k", label: "k  kill", min: 0.03, max: 0.07, step: 0.0005, value: 0.062 },
      { key: "Du", label: "Du", min: 0.08, max: 0.2, step: 0.005, value: 0.16 },
      { key: "Dv", label: "Dv", min: 0.04, max: 0.12, step: 0.002, value: 0.08 },
    ],
    sim.values,
  );
  sim.notes = [
    "Try F=0.035 k=0.065 spots, F=0.030 k=0.062 worms, F=0.018 k=0.051 spirals, F=0.026 k=0.053 mazes.",
  ];
  const show = () => {
    sim.frame = sim.view === "u" ? u : v;
  };
  const seed = () => {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const id = ix(n, i, j);
        u[id] = 1;
        v[id] = 0;
        const x = i / n - 0.5;
        const y = j / n - 0.5;
        if (x * x + y * y < 0.012) {
          u[id] = 0.5;
          v[id] = 0.25;
        }
        v[id] += (hash01(id, 9) - 0.5) * 0.04;
      }
    }
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    seed();
    show();
  };
  sim.setView = (id) => {
    sim.view = id;
    show();
  };
  sim.step = (times) => {
    const { F, k, Du, Dv } = sim.values;
    const sub = times * 8;
    for (let s = 0; s < sub; s++) {
      lap5(u, lu, n, "periodic");
      lap5(v, lv, n, "periodic");
      for (let i = 0; i < u.length; i++) {
        const uu = u[i];
        const vv = v[i];
        const uvv = uu * vv * vv;
        u[i] = uu + Du * lu[i] - uvv + F * (1 - uu);
        v[i] = vv + Dv * lv[i] + uvv - (F + k) * vv;
      }
    }
    sim.time += sub;
    if (isBlown(u) || isBlown(v)) sim.blown = true;
    show();
    pushFilm(sim, sim.frame);
  };
  sim.paint = (nx, ny) => {
    addGaussian2(v, n, nx, ny, 0.03, 0.35);
    addGaussian2(u, n, nx, ny, 0.03, -0.4);
    show();
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    const id = ix(n, i, j);
    return [
      { label: "u", value: fmt(u[id]) },
      { label: "v", value: fmt(v[id]) },
    ];
  };
  sim.stats = () =>
    makeStats(sim.frame, sim.time, DuSafe(sim) ? "stable" : "tight", DuSafe(sim) ? "feed " + fmt(sim.values.F) + " · kill " + fmt(sim.values.k) : "diffusion near the limit");
  sim.reset();
  return sim;
}

function DuSafe(sim: Sim) {
  return sim.values.Du <= 0.2 && sim.values.Dv <= 0.12;
}

function makeBarkley(): Sim {
  const n = 120;
  const sim = shell({ id: "barkley", n, dim: 2, cmap: "ink" });
  const u = sim.frame;
  const v = new Float32Array(n * n);
  const lu = new Float32Array(n * n);
  const nu = new Float32Array(n * n);
  const nv = new Float32Array(n * n);
  sim.views = [
    { id: "u", label: "u" },
    { id: "v", label: "v" },
  ];
  sim.controls = controls(
    [
      { key: "a", label: "a", min: 0.5, max: 0.95, step: 0.01, value: 0.75 },
      { key: "b", label: "b", min: 0.001, max: 0.08, step: 0.001, value: 0.01 },
      { key: "eps", label: "ε", min: 0.012, max: 0.06, step: 0.002, value: 0.02 },
    ],
    sim.values,
  );
  sim.notes = [
    "A broken wavefront. One side is still excitable, the other is refractory, so the tip curls instead of running off as a straight pulse.",
  ];
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const id = ix(n, i, j);
        u[id] = 0;
        v[id] = 0;
        if (j > n * 0.42 && j < n * 0.58) u[id] = 1;
        if (j >= n * 0.5 && j < n * 0.7) v[id] = 0.35;
        if (i > n * 0.55) {
          u[id] = 0;
          v[id] = 0;
        }
      }
    }
  };
  sim.setView = (id) => {
    sim.view = id;
    sim.frame = id === "v" ? v : u;
  };
  sim.step = (times) => {
    const a = Math.max(0.2, sim.values.a);
    const b = sim.values.b;
    const eps = Math.max(0.008, sim.values.eps);
    const dt = 0.04 * eps;
    const sub = Math.max(1, Math.round(times * 8));
    for (let s = 0; s < sub; s++) {
      lap5(u, lu, n, "neumann");
      for (let i = 0; i < u.length; i++) {
        const uu = u[i];
        const vv = v[i];
        const react = (uu * (1 - uu) * (uu - (vv + b) / a)) / eps;
        let un = uu + dt * (react + lu[i]);
        let vn = vv + dt * (uu - vv);
        if (un < -0.15) un = -0.15;
        if (un > 1.15) un = 1.15;
        if (vn < 0) vn = 0;
        if (vn > 1) vn = 1;
        nu[i] = un;
        nv[i] = vn;
      }
      u.set(nu);
      v.set(nv);
      sim.time += dt;
    }
    if (isBlown(u)) sim.blown = true;
    sim.frame = sim.view === "v" ? v : u;
    pushFilm(sim, sim.frame);
  };
  sim.paint = (nx, ny, _dx, _dy, polarity) => {
    addGaussian2(u, n, nx, ny, 0.045, polarity >= 0 ? 1 : 0);
    addGaussian2(v, n, nx, ny, 0.045, polarity >= 0 ? 0 : 0.4);
    sim.frame = sim.view === "v" ? v : u;
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    const id = ix(n, i, j);
    return [
      { label: "u", value: fmt(u[id]) },
      { label: "v", value: fmt(v[id]) },
    ];
  };
  sim.stats = () => makeStats(sim.frame, sim.time, sim.blown ? "blown" : "stable", sim.blown ? "blew up — raise ε" : "Barkley explicit");
  sim.reset();
  return sim;
}

function makePacket(): Sim {
  const n = 256;
  const sim = shell({ id: "packet", n, dim: 1, cmap: "ember" });
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const dens = sim.frame;
  const V = new Float32Array(n);
  const k2 = new Float32Array(n);
  sim.guide = V;
  for (let i = 0; i < n; i++) {
    const m = i <= n / 2 ? i : i - n;
    const k = (m * 2 * Math.PI) / 1;
    k2[i] = 0.5 * k * k;
  }
  sim.controls = controls(
    [
      { key: "k0", label: "k₀  momentum", min: 10, max: 90, step: 1, value: 40 },
      { key: "height", label: "barrier height", min: 0, max: 4000, step: 10, value: 700 },
      { key: "width", label: "barrier width", min: 0.01, max: 0.2, step: 0.005, value: 0.06 },
      { key: "sigma", label: "packet width", min: 0.02, max: 0.08, step: 0.002, value: 0.04 },
    ],
    sim.values,
  );
  const rebuildV = () => {
    const h = sim.values.height;
    const w = sim.values.width;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      V[i] = x > 0.55 && x < 0.55 + w ? h : 0;
    }
  };
  const writeDens = () => {
    let norm = 0;
    for (let i = 0; i < n; i++) {
      dens[i] = re[i] * re[i] + im[i] * im[i];
      norm += dens[i];
    }
    return norm / n;
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    rebuildV();
    const k0 = sim.values.k0;
    const sigma = sim.values.sigma;
    const x0 = 0.28;
    let norm = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = Math.exp(-((x - x0) * (x - x0)) / (2 * sigma * sigma));
      const phase = k0 * (x - x0);
      re[i] = env * Math.cos(phase);
      im[i] = env * Math.sin(phase);
      norm += env * env;
    }
    const s = Math.sqrt(norm / n);
    for (let i = 0; i < n; i++) {
      re[i] /= s;
      im[i] /= s;
    }
    writeDens();
  };
  sim.setParam = (key, value) => {
    sim.values[key] = value;
    if (key === "height" || key === "width") rebuildV();
  };
  sim.step = (times) => {
    const dt = 0.00004;
    const sub = times * 10;
    rebuildV();
    for (let s = 0; s < sub; s++) {
      fft(re, im, false);
      for (let i = 0; i < n; i++) {
        const phase = -k2[i] * dt;
        const c = Math.cos(phase);
        const sn = Math.sin(phase);
        const r = re[i];
        const m = im[i];
        re[i] = c * r - sn * m;
        im[i] = sn * r + c * m;
      }
      fft(re, im, true);
      for (let i = 0; i < n; i++) {
        const phase = -V[i] * dt;
        const c = Math.cos(phase);
        const sn = Math.sin(phase);
        const r = re[i];
        const m = im[i];
        re[i] = c * r - sn * m;
        im[i] = sn * r + c * m;
      }
      sim.time += dt;
    }
    const norm = writeDens();
    if (!Number.isFinite(norm) || norm > 5 || norm < 0.2) sim.blown = true;
    pushFilm(sim, dens);
    sim.notes[0] = "‖ψ‖² ≈ " + fmt(norm) + " · E₀ ≈ " + fmt(0.5 * sim.values.k0 * sim.values.k0);
  };
  sim.paint = (nx) => {
    const sigma = 0.03;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = Math.exp(-((x - nx) * (x - nx)) / (2 * sigma * sigma));
      const phase = sim.values.k0 * (x - nx);
      re[i] += 0.35 * env * Math.cos(phase);
      im[i] += 0.35 * env * Math.sin(phase);
    }
    writeDens();
  };
  sim.probe = (nx) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * n) % n));
    return [
      { label: "|ψ|²", value: fmt(dens[i]) },
      { label: "V", value: fmt(V[i]) },
    ];
  };
  sim.stats = () => makeStats(dens, sim.time, sim.blown ? "blown" : "stable", sim.blown ? "norm drifted" : "split-step", sim.notes[0]);
  sim.notes = ["‖ψ‖² ≈ 1"];
  sim.reset();
  return sim;
}

function makePoisson(): Sim {
  const n = 80;
  const sim = shell({ id: "poisson", n, dim: 2, cmap: "signed", forceSigned: true });
  const u = sim.frame;
  const rho = new Float32Array(n * n);
  let dirty = 0;
  sim.controls = controls(
    [{ key: "polarity", label: "charge  +1 / −1", min: -1, max: 1, step: 2, value: 1 }],
    sim.values,
  );
  const relax = (iters: number) => {
    const w = 1.86;
    for (let k = 0; k < iters; k++) {
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          const id = ix(n, i, j);
          const gs = (u[id - 1] + u[id + 1] + u[id - n] + u[id + n] + rho[id]) * 0.25;
          u[id] = (1 - w) * u[id] + w * gs;
        }
      }
    }
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    fill(u, 0);
    fill(rho, 0);
    addGaussian2(rho, n, 0.38, 0.5, 0.04, 40);
    addGaussian2(rho, n, 0.68, 0.42, 0.035, -28);
    dirty = 30;
    relax(80);
    sim.time = 1;
  };
  sim.step = (times) => {
    if (dirty > 0) {
      relax(12 * times);
      dirty -= times;
      sim.time += times;
      pushFilm(sim, u);
    }
  };
  sim.paint = (nx, ny) => {
    const amp = 36 * (sim.values.polarity >= 0 ? 1 : -1);
    addGaussian2(rho, n, nx, ny, 0.03, amp);
    dirty = 24;
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    const id = ix(n, i, j);
    return [
      { label: "φ", value: fmt(u[id]) },
      { label: "ρ", value: fmt(rho[id]) },
    ];
  };
  sim.overlay = (ctx, field) => {
    const { x, y, w, h } = field;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(231,240,234,0.55)";
    ctx.lineWidth = 1;
    const step = 5;
    for (let j = 2; j < n - 2; j += step) {
      for (let i = 2; i < n - 2; i += step) {
        const id = ix(n, i, j);
        const ex = -(u[id + 1] - u[id - 1]) * 0.5;
        const ey = -(u[id + n] - u[id - n]) * 0.5;
        const mag = Math.hypot(ex, ey) + 1e-6;
        const len = Math.min(10, mag * 1.4);
        const px = (i / (n - 1)) * w;
        const py = (j / (n - 1)) * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (ex / mag) * len, py + (ey / mag) * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  sim.stats = () => {
    const s = scan(u);
    return makeStats(u, sim.time, "stable", dirty > 0 ? "relaxing" : "converged", "φ " + fmt(s.min) + " … " + fmt(s.max));
  };
  sim.notes = ["Positive charge is copper-bright on this scale when it dominates. Flip the charge slider, then click."];
  sim.reset();
  return sim;
}

function makeInk(): Sim {
  const n = 68;
  const sim = shell({ id: "ink", n, dim: 2, cmap: "ink" });
  const size = n * n;
  const dens = new Float32Array(size);
  const dens0 = new Float32Array(size);
  const u = new Float32Array(size);
  const v = new Float32Array(size);
  const u0 = new Float32Array(size);
  const v0 = new Float32Array(size);
  sim.frame = dens;
  sim.controls = controls(
    [
      { key: "visc", label: "ν  viscosity", min: 0, max: 0.002, step: 0.00005, value: 0.00015 },
      { key: "diff", label: "dye diffusion", min: 0, max: 0.001, step: 0.00002, value: 0.00005 },
      { key: "fade", label: "dye fade", min: 0.9, max: 1, step: 0.001, value: 0.998 },
    ],
    sim.values,
  );
  const IX = (i: number, j: number) => i + j * n;
  const setBnd = (b: number, x: Float32Array) => {
    for (let i = 1; i < n - 1; i++) {
      x[IX(0, i)] = b === 1 ? -x[IX(1, i)] : x[IX(1, i)];
      x[IX(n - 1, i)] = b === 1 ? -x[IX(n - 2, i)] : x[IX(n - 2, i)];
      x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, n - 1)] = b === 2 ? -x[IX(i, n - 2)] : x[IX(i, n - 2)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, n - 1)] = 0.5 * (x[IX(1, n - 1)] + x[IX(0, n - 2)]);
    x[IX(n - 1, 0)] = 0.5 * (x[IX(n - 2, 0)] + x[IX(n - 1, 1)]);
    x[IX(n - 1, n - 1)] = 0.5 * (x[IX(n - 2, n - 1)] + x[IX(n - 1, n - 2)]);
  };
  const linSolve = (b: number, x: Float32Array, x0: Float32Array, a: number, c: number) => {
    const inv = 1 / c;
    for (let k = 0; k < 10; k++) {
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i - 1, j)] + x[IX(i + 1, j)] + x[IX(i, j - 1)] + x[IX(i, j + 1)])) * inv;
        }
      }
      setBnd(b, x);
    }
  };
  const diffuse = (b: number, x: Float32Array, x0: Float32Array, diff: number, dt: number) => {
    const a = dt * diff * (n - 2) * (n - 2);
    linSolve(b, x, x0, a, 1 + 4 * a);
  };
  const advect = (b: number, d: Float32Array, d0: Float32Array, uu: Float32Array, vv: Float32Array, dt: number) => {
    const dt0 = dt * (n - 2);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        let x = i - dt0 * uu[IX(i, j)];
        let y = j - dt0 * vv[IX(i, j)];
        if (x < 0.5) x = 0.5;
        if (x > n - 1.5) x = n - 1.5;
        if (y < 0.5) y = 0.5;
        if (y > n - 1.5) y = n - 1.5;
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const s1 = x - i0;
        const s0 = 1 - s1;
        const t1 = y - j0;
        const t0 = 1 - t1;
        d[IX(i, j)] =
          s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j0 + 1)]) +
          s1 * (t0 * d0[IX(i0 + 1, j0)] + t1 * d0[IX(i0 + 1, j0 + 1)]);
      }
    }
    setBnd(b, d);
  };
  const project = (uu: Float32Array, vv: Float32Array, p: Float32Array, div: Float32Array) => {
    const h = 1 / (n - 2);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        div[IX(i, j)] = -0.5 * h * (uu[IX(i + 1, j)] - uu[IX(i - 1, j)] + vv[IX(i, j + 1)] - vv[IX(i, j - 1)]);
        p[IX(i, j)] = 0;
      }
    }
    setBnd(0, div);
    setBnd(0, p);
    linSolve(0, p, div, 1, 4);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        uu[IX(i, j)] -= (0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)])) / h;
        vv[IX(i, j)] -= (0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)])) / h;
      }
    }
    setBnd(1, uu);
    setBnd(2, vv);
  };
  const blob = (cx: number, cy: number, amp: number) => {
    addGaussian2(dens, n, cx, cy, 0.06, amp);
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    dens.fill(0);
    u.fill(0);
    v.fill(0);
    blob(0.32, 0.55, 22);
    blob(0.58, 0.42, 16);
    blob(0.48, 0.68, 12);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const x = i / (n - 1) - 0.5;
        const y = j / (n - 1) - 0.5;
        u[IX(i, j)] = -y * 0.15;
        v[IX(i, j)] = x * 0.15;
      }
    }
    setBnd(1, u);
    setBnd(2, v);
  };
  sim.step = (times) => {
    const dt = 0.1;
    const visc = sim.values.visc;
    const diff = sim.values.diff;
    const fade = sim.values.fade;
    for (let s = 0; s < times; s++) {
      u0.set(u);
      v0.set(v);
      diffuse(1, u, u0, visc, dt);
      diffuse(2, v, v0, visc, dt);
      project(u, v, u0, v0);
      u0.set(u);
      v0.set(v);
      advect(1, u, u0, u0, v0, dt);
      advect(2, v, v0, u0, v0, dt);
      project(u, v, u0, v0);
      dens0.set(dens);
      diffuse(0, dens, dens0, diff, dt);
      dens0.set(dens);
      advect(0, dens, dens0, u, v, dt);
      for (let i = 0; i < size; i++) dens[i] *= fade;
      sim.time += dt;
    }
    if (isBlown(dens) || isBlown(u)) sim.blown = true;
    sim.frame = dens;
    pushFilm(sim, dens);
  };
  sim.paint = (nx, ny, dx, dy) => {
    const i = Math.max(1, Math.min(n - 2, Math.round(nx * (n - 1))));
    const j = Math.max(1, Math.min(n - 2, Math.round(ny * (n - 1))));
    const r = 2;
    for (let jj = j - r; jj <= j + r; jj++) {
      for (let ii = i - r; ii <= i + r; ii++) {
        if (ii < 1 || jj < 1 || ii > n - 2 || jj > n - 2) continue;
        dens[IX(ii, jj)] += 2.2;
        u[IX(ii, jj)] += dx * 40;
        v[IX(ii, jj)] += dy * 40;
      }
    }
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    return [
      { label: "dye", value: fmt(dens[IX(i, j)]) },
      { label: "speed", value: fmt(Math.hypot(u[IX(i, j)], v[IX(i, j)])) },
    ];
  };
  sim.overlay = (ctx, field) => {
    const { x, y, w, h } = field;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(224,138,69,0.45)";
    ctx.lineWidth = 1;
    const stepN = 6;
    for (let j = 2; j < n - 2; j += stepN) {
      for (let i = 2; i < n - 2; i += stepN) {
        const vx = u[IX(i, j)];
        const vy = v[IX(i, j)];
        const mag = Math.hypot(vx, vy);
        if (mag < 0.01) continue;
        const len = Math.min(12, mag * 18);
        const px = (i / (n - 1)) * w;
        const py = (j / (n - 1)) * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + (vx / mag) * len, py + (vy / mag) * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  sim.stats = () => makeStats(dens, sim.time, sim.blown ? "blown" : "stable", sim.blown ? "blew up" : "stable fluids");
  sim.notes = ["Drag across the dish to stir. The arrows are velocity, not the 2015 vector field that only incremented."];
  sim.reset();
  return sim;
}

function makeScript(source: string): Sim {
  let compiled;
  try {
    compiled = compileScript(source);
  } catch (err) {
    if (err instanceof ScriptError) throw err;
    throw new ScriptError(0, err instanceof Error ? err.message : "could not compile");
  }
  const n = 112;
  const names = [...compiled.fields.map((f) => f.name), ...compiled.temps];
  const index = new Map(names.map((name, i) => [name, i]));
  const F = names.map(() => new Float32Array(n * n));
  const P = new Float64Array(compiled.params.map((p) => p.value));
  const tmp = new Float32Array(n * n);
  const rhs = compiled.fieldKernels.map(() => new Float32Array(n * n));
  const opBufs = compiled.fieldKernels.map((k) => k.ops.map(() => new Float32Array(n * n)));
  const sim = shell({ id: "script", n, dim: 2, cmap: "tide" });
  sim.controls = compiled.controls.map((c) => ({ ...c }));
  sim.values = Object.fromEntries(compiled.params.map((p) => [p.name, p.value]));
  sim.views = compiled.fields.map((f) => ({ id: f.name, label: f.name }));
  sim.view = compiled.view;
  sim.notes = compiled.warnings;
  const paramSlot = new Map(compiled.params.map((p, i) => [p.name, i]));

  const syncP = () => {
    compiled.params.forEach((p, i) => {
      P[i] = sim.values[p.name] ?? p.value;
    });
  };
  const show = () => {
    const idx = index.get(sim.view) ?? 0;
    sim.frame = F[idx];
  };
  const prep = (ops: { src: string; op: "lap" | "laplac" | "dx" | "dy" }[], bufs: Float32Array[]) => {
    for (let k = 0; k < ops.length; k++) {
      const srcI = index.get(ops[k].src);
      if (srcI === undefined) throw new ScriptError(0, `missing field ${ops[k].src}`);
      applyOp(ops[k].op, F[srcI], bufs[k], n, compiled.bc);
    }
  };
  sim.reset = () => {
    sim.time = 0;
    sim.blown = false;
    sim.filmRow = 0;
    sim.filmCount = 0;
    sim.film?.fill(0);
    syncP();
    compiled.fields.forEach((f, i) => F[i].fill(f.init));
    for (const temp of compiled.temps) F[index.get(temp)!].fill(0);
    for (const ic of compiled.ics) {
      const dest = F[index.get(ic.name)!];
      for (let j = 0; j < n; j++) {
        const y = j / (n - 1);
        for (let i = 0; i < n; i++) {
          const id = ix(n, i, j);
          const x = i / (n - 1);
          dest[id] = ic.fn(id, x, y, 0, F, [], P, noiseAt);
        }
      }
    }
    if (!compiled.ics.length) {
      compiled.fields.slice(0, 2).forEach((f, k) => {
        addGaussian2(F[index.get(f.name)!], n, 0.38 + k * 0.24, 0.52 - k * 0.06, 0.065, 1);
      });
      if (!sim.notes.some((note) => note.startsWith("No initial"))) {
        sim.notes = [
          ...sim.notes,
          "No initial condition in the file — seeded a hot spot so the stencil is visible. Paint the field to draw your own.",
        ];
      }
    }
    show();
  };
  sim.setParam = (key, value) => {
    sim.values[key] = value;
    const slot = paramSlot.get(key);
    if (slot !== undefined) P[slot] = value;
  };
  sim.setView = (id) => {
    sim.view = id;
    show();
  };
  sim.step = (times) => {
    syncP();
    const dtSlot = paramSlot.get("dt");
    const dt = dtSlot === undefined ? 1 : P[dtSlot];
    try {
      for (let s = 0; s < times; s++) {
        const tArg = dtSlot !== undefined && paramSlot.has("t") ? P[paramSlot.get("t")!] : sim.time;
        for (const k of compiled.scalarKernels) {
          const slot = paramSlot.get(k.lhs);
          if (slot === undefined) continue;
          const value = k.fn(0, 0, 0, tArg, F, [], P, noiseAt);
          P[slot] = value;
          sim.values[k.lhs] = value;
        }
        if (compiled.mode === "assign") {
          for (let ki = 0; ki < compiled.fieldKernels.length; ki++) {
            const k = compiled.fieldKernels[ki];
            prep(k.ops, opBufs[ki]);
            for (let j = 0; j < n; j++) {
              const y = j / (n - 1);
              for (let i = 0; i < n; i++) {
                const id = ix(n, i, j);
                tmp[id] = k.fn(id, i / (n - 1), y, tArg, F, opBufs[ki], P, noiseAt);
              }
            }
            F[index.get(k.lhs)!].set(tmp);
          }
        } else {
          for (let ki = 0; ki < compiled.fieldKernels.length; ki++) {
            const k = compiled.fieldKernels[ki];
            prep(k.ops, opBufs[ki]);
            const out = rhs[ki];
            for (let j = 0; j < n; j++) {
              const y = j / (n - 1);
              for (let i = 0; i < n; i++) {
                const id = ix(n, i, j);
                out[id] = k.fn(id, i / (n - 1), y, sim.time, F, opBufs[ki], P, noiseAt);
              }
            }
          }
          for (let ki = 0; ki < compiled.fieldKernels.length; ki++) {
            const dest = F[index.get(compiled.fieldKernels[ki].lhs)!];
            const out = rhs[ki];
            for (let i = 0; i < dest.length; i++) dest[i] += dt * out[i];
          }
        }
        sim.time += Math.abs(dt) || 1;
        show();
        if (isBlown(sim.frame)) {
          sim.blown = true;
          break;
        }
      }
    } catch (err) {
      sim.blown = true;
      sim.notes = [err instanceof Error ? err.message : "step failed"];
    }
    pushFilm(sim, sim.frame);
  };
  sim.paint = (nx, ny, _dx, _dy, polarity) => {
    const dest = F[index.get(sim.view) ?? 0];
    addGaussian2(dest, n, nx, ny, 0.04, (polarity || 1) * 0.8);
    show();
  };
  sim.probe = (nx, ny) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
    const id = ix(n, i, j);
    return compiled.fields.slice(0, 4).map((f) => ({ label: f.name, value: fmt(F[index.get(f.name)!][id]) }));
  };
  sim.stats = () =>
    makeStats(
      sim.frame,
      sim.time,
      sim.blown ? "blown" : "stable",
      sim.blown ? "blew up — lower dt" : compiled.mode === "deriv" ? "Euler  " + compiled.bc : "assignment  " + compiled.bc,
      compiled.fields.map((f) => f.name).join(" · "),
    );
  sim.reset();
  return sim;
}

function sample2(a: Float32Array, n: number, nx: number, ny: number, label: string) {
  const i = Math.max(0, Math.min(n - 1, Math.round(nx * (n - 1))));
  const j = Math.max(0, Math.min(n - 1, Math.round(ny * (n - 1))));
  return [
    { label, value: fmt(a[ix(n, i, j)]) },
    { label: "x", value: fmt(i / (n - 1)) },
    { label: "y", value: fmt(j / (n - 1)) },
  ];
}

export function fmt(v: number) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 10000)) return v.toExponential(2);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export { ScriptError };
