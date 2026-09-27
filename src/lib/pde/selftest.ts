import { fft } from "@/lib/pde/field";
import { SCRIPT_EXAMPLES } from "@/lib/pde/script";
import { createSim } from "@/lib/pde/sims";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function fftRoundtrip() {
  const n = 64;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.sin(i) * 0.3 + (i % 5) * 0.01;
    im[i] = Math.cos(i * 0.5) * 0.2;
  }
  const re0 = re.slice();
  const im0 = im.slice();
  fft(re, im, false);
  fft(re, im, true);
  let err = 0;
  for (let i = 0; i < n; i++) err += Math.abs(re[i] - re0[i]) + Math.abs(im[i] - im0[i]);
  assert(err < 1e-3, "fft roundtrip " + err);
}

function heatError() {
  const sim = createSim("heat1");
  for (let i = 0; i < 40; i++) sim.step(1);
  const stats = sim.stats();
  assert(Boolean(stats.extra?.includes("L2")), "heat should report L2");
  const m = /L2 error ([0-9.eE+-]+)/.exec(stats.extra ?? "");
  const err = m ? Number(m[1]) : 1;
  assert(err < 0.02, "heat L2 " + err + " at t=" + sim.time);
  assert(!sim.blown, "heat blew up");
}

function legacySpreads() {
  const src = SCRIPT_EXAMPLES.find((e) => e.id === "pder2015")!.source;
  const sim = createSim("script", src);
  const before = sim.stats().max;
  for (let i = 0; i < 25; i++) sim.step(1);
  assert(!sim.blown, "legacy blew up " + sim.notes.join("; "));
  assert(Number.isFinite(sim.stats().max), "legacy non finite");
  assert(sim.stats().max < before, "legacy hot spot should decay, before " + before + " after " + sim.stats().max);
}

function grayLives() {
  const sim = createSim("gray");
  for (let i = 0; i < 8; i++) sim.step(1);
  const s = sim.stats();
  assert(!sim.blown, "gray blew");
  assert(s.max > 0.05 && s.max < 1.5, "gray max " + s.max);
  assert(s.min > -0.05, "gray min " + s.min);
}

function burgersSteepens() {
  const sim = createSim("burgers");
  const slope0 = Number(/max \|Δu\| ([0-9.eE+-]+)/.exec(sim.stats().extra ?? "")?.[1] ?? "0");
  for (let i = 0; i < 30; i++) sim.step(1);
  const slope1 = Number(/max \|Δu\| ([0-9.eE+-]+)/.exec(sim.stats().extra ?? "")?.[1] ?? "0");
  assert(!sim.blown, "burgers blew");
  assert(slope1 > slope0 * 1.15, "burgers slope " + slope0 + " -> " + slope1);
}

function poissonSign() {
  const sim = createSim("poisson");
  let pos = 0;
  let neg = 0;
  const n = sim.n;
  for (let i = 0; i < sim.frame.length; i++) {
    const x = (i % n) / (n - 1);
    if (sim.frame[i] > 0.2 && x < 0.5) pos++;
    if (sim.frame[i] < -0.05 && x > 0.55) neg++;
  }
  assert(pos > 10, "positive well missing " + pos);
  assert(neg > 5, "negative well missing " + neg);
}

function packetNormAndDrift() {
  const sim = createSim("packet");
  const n = sim.n;
  const centroid = () => {
    let m = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      m += sim.frame[i];
      c += sim.frame[i] * (i / n);
    }
    return c / m;
  };
  const c0 = centroid();
  for (let i = 0; i < 12; i++) sim.step(1);
  const c1 = centroid();
  assert(!sim.blown, "packet blew " + sim.stats().extra);
  const extra = sim.stats().extra ?? "";
  assert(extra.includes("1.0") || extra.includes("0.9") || extra.includes("1.00"), "norm " + extra);
  assert(c1 > c0, "packet should move right " + c0 + " -> " + c1);
}

function waveBounded() {
  const sim = createSim("string");
  for (let i = 0; i < 40; i++) sim.step(1);
  const s = sim.stats();
  assert(!sim.blown, "string blew");
  assert(s.max < 2 && s.max > 0.05, "string max " + s.max);
}

function inkFinite() {
  const sim = createSim("ink");
  sim.paint(0.4, 0.5, 0.02, 0.01, 1);
  for (let i = 0; i < 8; i++) sim.step(1);
  assert(!sim.blown, "ink blew");
  assert(sim.stats().max > 0.2, "ink empty " + sim.stats().max);
}

function grayScript() {
  const src = SCRIPT_EXAMPLES.find((e) => e.id === "gray")!.source;
  const sim = createSim("script", src);
  for (let i = 0; i < 6; i++) sim.step(1);
  assert(!sim.blown, "script gray blew " + sim.notes.join(" "));
  assert(sim.stats().max > 0.02, "script gray max " + sim.stats().max);
}

const tests = [
  fftRoundtrip,
  heatError,
  legacySpreads,
  grayLives,
  burgersSteepens,
  poissonSign,
  packetNormAndDrift,
  waveBounded,
  inkFinite,
  grayScript,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log("ok", t.name);
  } catch (err) {
    failed++;
    console.error("FAIL", t.name, err instanceof Error ? err.message : err);
  }
}
if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("all passed");
