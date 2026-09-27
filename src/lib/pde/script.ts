import { derivX, derivY, hash01, lap5, laplacLegacy } from "@/lib/pde/field";
import type { BC, ParamDef } from "@/lib/pde/types";

export class ScriptError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(line > 0 ? `Line ${line}: ${message}` : message);
    this.line = line;
  }
}

type Expr =
  | { k: "n"; v: number }
  | { k: "id"; n: string }
  | { k: "u"; a: Expr }
  | { k: "b"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "c"; n: string; args: Expr[] };

type FieldDecl = { name: string; init: number };
type ParamDecl = { name: string; value: number; min: number; max: number };

type Stmt =
  | { k: "field"; line: number; name: string; init: number }
  | { k: "param"; line: number; name: string; value: number; min: number; max: number }
  | { k: "ic"; line: number; name: string; expr: Expr }
  | { k: "bc"; line: number; bc: BC }
  | { k: "view"; line: number; name: string }
  | { k: "deriv"; line: number; name: string; expr: Expr }
  | { k: "assign"; line: number; name: string; expr: Expr };

const FUNCS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "exp",
  "log",
  "abs",
  "sqrt",
  "sign",
  "min",
  "max",
  "pow",
  "ustp",
  "step",
  "lap",
  "laplac",
  "dx",
  "dy",
  "noise",
]);

const FIELD_OPS = new Set(["lap", "laplac", "dx", "dy"]);

class Parser {
  s: string;
  i = 0;
  line: number;
  constructor(s: string, line: number) {
    this.s = s;
    this.line = line;
  }
  err(m: string): never {
    throw new ScriptError(this.line, m);
  }
  skip() {
    while (this.i < this.s.length && /[ \t]/.test(this.s[this.i])) this.i++;
  }
  parseExpr(): Expr {
    const e = this.parseAdd();
    this.skip();
    if (this.i < this.s.length) this.err(`unexpected '${this.s[this.i]}'`);
    return e;
  }
  parseAdd(): Expr {
    let left = this.parseMul();
    for (;;) {
      this.skip();
      const c = this.s[this.i];
      if (c !== "+" && c !== "-") break;
      this.i++;
      const right = this.parseMul();
      left = { k: "b", op: c, a: left, b: right };
    }
    return left;
  }
  parseMul(): Expr {
    let left = this.parsePow();
    for (;;) {
      this.skip();
      const c = this.s[this.i];
      if (c !== "*" && c !== "/") break;
      this.i++;
      const right = this.parsePow();
      left = { k: "b", op: c, a: left, b: right };
    }
    return left;
  }
  parsePow(): Expr {
    const left = this.parseUnary();
    this.skip();
    if (this.s[this.i] !== "^") return left;
    this.i++;
    const right = this.parsePow();
    return { k: "b", op: "^", a: left, b: right };
  }
  parseUnary(): Expr {
    this.skip();
    if (this.s[this.i] === "+") {
      this.i++;
      return this.parseUnary();
    }
    if (this.s[this.i] === "-") {
      this.i++;
      return { k: "u", a: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  parsePrimary(): Expr {
    this.skip();
    const c = this.s[this.i];
    if (!c) this.err("expression ended early");
    if (c === "(") {
      this.i++;
      const inner = this.parseAdd();
      this.skip();
      if (this.s[this.i] !== ")") this.err("missing ')'");
      this.i++;
      return inner;
    }
    if (/[0-9.]/.test(c)) return this.parseNumber();
    if (/[A-Za-z_]/.test(c)) {
      const name = this.parseIdent();
      this.skip();
      if (this.s[this.i] === "(") {
        this.i++;
        const args: Expr[] = [];
        this.skip();
        if (this.s[this.i] !== ")") {
          for (;;) {
            args.push(this.parseAdd());
            this.skip();
            if (this.s[this.i] === ",") {
              this.i++;
              continue;
            }
            break;
          }
        }
        if (this.s[this.i] !== ")") this.err("missing ')'");
        this.i++;
        if (!FUNCS.has(name)) this.err(`unknown function ${name}`);
        return { k: "c", n: name, args };
      }
      return { k: "id", n: name };
    }
    this.err(`unexpected '${c}'`);
  }
  parseNumber(): Expr {
    const start = this.i;
    if (this.s[this.i] === ".") this.i++;
    while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++;
    if (this.s[this.i] === ".") {
      this.i++;
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++;
    }
    if (this.s[this.i] === "e" || this.s[this.i] === "E") {
      this.i++;
      if (this.s[this.i] === "+" || this.s[this.i] === "-") this.i++;
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++;
    }
    const raw = this.s.slice(start, this.i);
    const v = Number(raw);
    if (!Number.isFinite(v)) this.err(`bad number ${raw}`);
    return { k: "n", v };
  }
  parseIdent(): string {
    const start = this.i;
    this.i++;
    while (this.i < this.s.length && /[A-Za-z0-9_]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }
}

function stripComment(line: string) {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#") break;
    out += line[i];
  }
  return out.trim();
}

function looksLegacy(src: string) {
  return /(^|\n)\s*##/.test(src) || /(^|\n)\s*scalar\s+/i.test(src);
}

function parseModern(src: string): Stmt[] {
  const stmts: Stmt[] = [];
  const lines = src.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    const raw = lines[li];
    if (/^\s*##/.test(raw)) {
      throw new ScriptError(
        lineNo,
        "this looks like a PDER 1.0 section. Paste the whole file — sections are detected automatically.",
      );
    }
    const line = stripComment(raw);
    if (!line) continue;
    const field = /^(?:field|scalar)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/i.exec(line);
    if (field) {
      const p = new Parser(field[2], lineNo);
      const e = p.parseExpr();
      if (e.k !== "n") throw new ScriptError(lineNo, "field initial value must be a number");
      stmts.push({ k: "field", line: lineNo, name: field[1], init: e.v });
      continue;
    }
    const param = /^param\s+([A-Za-z_]\w*)\s*=\s*([^\[]+?)(?:\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\])?\s*$/i.exec(
      line,
    );
    if (param) {
      const value = num(param[2], lineNo);
      let min = value;
      let max = value;
      if (param[3] != null) {
        min = num(param[3], lineNo);
        max = num(param[4], lineNo);
      } else {
        const span = Math.max(Math.abs(value) * 4, 1);
        min = value - span;
        max = value + span;
      }
      if (!(max > min)) throw new ScriptError(lineNo, "parameter max must be greater than min");
      stmts.push({ k: "param", line: lineNo, name: param[1], value, min, max });
      continue;
    }
    const ic = /^ic\s+([A-Za-z_]\w*)\s*=\s*(.+)$/i.exec(line);
    if (ic) {
      stmts.push({ k: "ic", line: lineNo, name: ic[1], expr: new Parser(ic[2], lineNo).parseExpr() });
      continue;
    }
    const bc = /^bc\s+(periodic|dirichlet|neumann)\s*$/i.exec(line);
    if (bc) {
      stmts.push({ k: "bc", line: lineNo, bc: bc[1].toLowerCase() as BC });
      continue;
    }
    const view = /^view\s+([A-Za-z_]\w*)\s*$/i.exec(line);
    if (view) {
      stmts.push({ k: "view", line: lineNo, name: view[1] });
      continue;
    }
    const deriv = /^([A-Za-z_]\w*)\s*'\s*=\s*(.+)$/.exec(line);
    if (deriv) {
      stmts.push({
        k: "deriv",
        line: lineNo,
        name: deriv[1],
        expr: new Parser(deriv[2], lineNo).parseExpr(),
      });
      continue;
    }
    const assign = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line);
    if (assign) {
      stmts.push({
        k: "assign",
        line: lineNo,
        name: assign[1],
        expr: new Parser(assign[2], lineNo).parseExpr(),
      });
      continue;
    }
    throw new ScriptError(lineNo, `can't read '${line}'`);
  }
  return stmts;
}

function num(s: string, line: number) {
  const v = Number(s.trim());
  if (!Number.isFinite(v)) throw new ScriptError(line, `bad number '${s.trim()}'`);
  return v;
}

function parseLegacy(src: string): {
  stmts: Stmt[];
  warnings: string[];
  colorHints: { name: string; min: number; max: number }[];
} {
  const warnings: string[] = [];
  const stmts: Stmt[] = [];
  type Sec = "none" | "var" | "const" | "range" | "eq" | "file";
  let sec: Sec = "none";
  const lines = src.split(/\r?\n/);
  const ranges = new Map<string, { min: number; max: number; show: boolean }>();
  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    const raw = lines[li];
    const head = raw.trim();
    if (/^##/.test(head)) {
      const h = head.toLowerCase();
      if (h.includes("variable")) sec = "var";
      else if (h.includes("constant")) sec = "const";
      else if (h.includes("range")) sec = "range";
      else if (h.includes("equation") || h.includes("equat")) sec = "eq";
      else sec = "file";
      continue;
    }
    const line = stripComment(raw);
    if (!line || sec === "file" || sec === "none") continue;
    if (sec === "var") {
      const m = /^(scalar|vector)\s+([A-Za-z_]\w*)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/i.exec(
        line,
      );
      if (!m) throw new ScriptError(lineNo, `expected 'scalar name value', got '${line}'`);
      if (m[1].toLowerCase() === "vector") {
        warnings.push(
          `Line ${lineNo}: vector ${m[2]} is kept as a scalar. Curl and divergence live on the Ink and Electrostatics benches.`,
        );
      }
      stmts.push({ k: "field", line: lineNo, name: m[2], init: Number(m[3]) });
      continue;
    }
    if (sec === "const") {
      const m = /^([A-Za-z_]\w*)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/.exec(line);
      if (!m) throw new ScriptError(lineNo, `expected 'name value', got '${line}'`);
      stmts.push({
        k: "param",
        line: lineNo,
        name: m[1],
        value: Number(m[2]),
        min: Number(m[2]),
        max: Number(m[2]),
      });
      continue;
    }
    if (sec === "range") {
      const m =
        /^([A-Za-z_]\w*)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+(\w+)\s*$/.exec(
          line,
        );
      if (!m) throw new ScriptError(lineNo, `expected 'name min max tag', got '${line}'`);
      ranges.set(m[1], { min: Number(m[2]), max: Number(m[3]), show: m[4].toLowerCase() === "show" });
      continue;
    }
    if (sec === "eq") {
      const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line);
      if (!m) throw new ScriptError(lineNo, `expected an assignment, got '${line}'`);
      stmts.push({
        k: "assign",
        line: lineNo,
        name: m[1],
        expr: new Parser(m[2], lineNo).parseExpr(),
      });
    }
  }
  for (const s of stmts) {
    if (s.k !== "param") continue;
    const r = ranges.get(s.name);
    if (r && r.max > r.min) {
      s.min = r.min;
      s.max = r.max;
    } else {
      const span = Math.max(Math.abs(s.value) * 4, 0.1);
      s.min = s.value >= 0 ? Math.min(s.value, span * 0.05) : s.value - span;
      s.max = s.value >= 0 ? Math.max(s.value * 5, s.value + span) : s.value + span;
      if (!(s.max > s.min)) {
        s.min = s.value - 1;
        s.max = s.value + 1;
      }
    }
  }
  const fieldRanges: { name: string; min: number; max: number }[] = [];
  for (const [name, r] of ranges) {
    if (stmts.some((s) => s.k === "field" && s.name === name) && r.max > r.min) {
      fieldRanges.push({ name, min: r.min, max: r.max });
    }
  }
  return { stmts, warnings, colorHints: fieldRanges };
}

function usesSpatial(e: Expr, fields: Set<string>): boolean {
  if (e.k === "id") return fields.has(e.n) || e.n === "x" || e.n === "y";
  if (e.k === "n") return false;
  if (e.k === "u") return usesSpatial(e.a, fields);
  if (e.k === "b") return usesSpatial(e.a, fields) || usesSpatial(e.b, fields);
  if (FIELD_OPS.has(e.n) || e.n === "noise") return true;
  return e.args.some((a) => usesSpatial(a, fields));
}

type Op = { src: string; op: "lap" | "laplac" | "dx" | "dy" };

type Kernel = {
  line: number;
  lhs: string;
  kind: "field" | "param";
  ops: Op[];
  fn: (
    i: number,
    x: number,
    y: number,
    t: number,
    F: Float32Array[],
    O: Float32Array[],
    P: Float64Array,
    N: (i: number) => number,
  ) => number;
};

export type CompiledScript = {
  bc: BC;
  mode: "deriv" | "assign";
  fields: FieldDecl[];
  temps: string[];
  params: ParamDecl[];
  controls: ParamDef[];
  view: string;
  warnings: string[];
  ics: { name: string; fn: Kernel["fn"] }[];
  fieldKernels: Kernel[];
  scalarKernels: Kernel[];
  colorHints: { name: string; min: number; max: number }[];
};

function emitExpr(
  e: Expr,
  line: number,
  fields: Map<string, number>,
  params: Map<string, number>,
  ops: Op[],
  allowNoise: boolean,
  allowFieldOps: boolean,
): string {
  const bad = (m: string): never => {
    throw new ScriptError(line, m);
  };
  const walk = (node: Expr): string => {
    if (node.k === "n") return `(${node.v})`;
    if (node.k === "u") return `(-${walk(node.a)})`;
    if (node.k === "b") {
      if (node.op === "^") return `Math.pow(${walk(node.a)},${walk(node.b)})`;
      return `(${walk(node.a)}${node.op}${walk(node.b)})`;
    }
    if (node.k === "id") {
      if (node.n === "x" || node.n === "y") return node.n;
    if (node.n === "t") {
      if (params.has("t")) return `P[${params.get("t")}]`;
      return "t";
    }
      if (node.n === "pi" || node.n === "PI") return "Math.PI";
      if (fields.has(node.n)) return `F[${fields.get(node.n)}][i]`;
      if (params.has(node.n)) return `P[${params.get(node.n)}]`;
      bad(`unknown name '${node.n}'`);
    }
    if (node.k !== "c") {
      throw new ScriptError(line, "bad expression");
    }
    const name = node.n;
    if (FIELD_OPS.has(name)) {
      if (!allowFieldOps) bad(`${name}() is only allowed in the update equations`);
      const arg0 = node.args[0];
      if (node.args.length !== 1 || !arg0 || arg0.k !== "id" || !fields.has(arg0.n)) {
        bad(`${name}() takes a single field name`);
      }
      if (arg0.k !== "id") throw new ScriptError(line, `${name}() takes a single field name`);
      const idx = ops.length;
      ops.push({ src: arg0.n, op: name as Op["op"] });
      return `O[${idx}][i]`;
    }
    if (name === "noise") {
      if (!allowNoise) bad("noise() is only allowed in ic lines");
      if (node.args.length) bad("noise() takes no arguments");
      return "N(i)";
    }
    const math: Record<string, string> = {
      sin: "Math.sin",
      cos: "Math.cos",
      tan: "Math.tan",
      asin: "Math.asin",
      acos: "Math.acos",
      atan: "Math.atan",
      exp: "Math.exp",
      log: "Math.log",
      abs: "Math.abs",
      sqrt: "Math.sqrt",
      min: "Math.min",
      max: "Math.max",
      pow: "Math.pow",
    };
    if (name === "sign" || name === "ustp" || name === "step") {
      if (node.args.length !== 1) bad(`${name}() takes one argument`);
      const inner = walk(node.args[0]);
      if (name === "sign") return `(${inner}<0?-1:${inner}>0?1:0)`;
      return `(${inner}>0?1:0)`;
    }
    const fn = math[name];
    if (!fn) bad(`unknown function ${name}`);
    return `${fn}(${node.args.map(walk).join(",")})`;
  };
  return walk(e);
}

function compileFn(body: string, line: number): Kernel["fn"] {
  try {
    return new Function("i", "x", "y", "t", "F", "O", "P", "N", `return ${body};`) as Kernel["fn"];
  } catch {
    throw new ScriptError(line, "couldn't compile that expression");
  }
}

export function compileScript(src: string): CompiledScript {
  const legacy = looksLegacy(src);
  const warnings: string[] = [];
  let stmts: Stmt[];
  let colorHints: CompiledScript["colorHints"] = [];
  if (legacy) {
    const parsed = parseLegacy(src);
    stmts = parsed.stmts;
    warnings.push(...parsed.warnings);
    colorHints = parsed.colorHints;
    warnings.push(
      "PDER 1.0 file. laplac() is the original wide stencil in grid units — it is not divided by Δx².",
    );
  } else {
    stmts = parseModern(src);
  }

  const fields: FieldDecl[] = [];
  const params: ParamDecl[] = [];
  const fieldSet = new Set<string>();
  const paramSet = new Set<string>();
  for (const s of stmts) {
    if (s.k === "field") {
      if (fieldSet.has(s.name) || paramSet.has(s.name))
        throw new ScriptError(s.line, `duplicate name ${s.name}`);
      if (s.name === "x" || s.name === "y") throw new ScriptError(s.line, `${s.name} is reserved for coordinates`);
      fieldSet.add(s.name);
      fields.push({ name: s.name, init: s.init });
    }
    if (s.k === "param") {
      if (fieldSet.has(s.name) || paramSet.has(s.name))
        throw new ScriptError(s.line, `duplicate name ${s.name}`);
      if (s.name === "x" || s.name === "y") throw new ScriptError(s.line, `${s.name} is reserved for coordinates`);
      paramSet.add(s.name);
      params.push({ name: s.name, value: s.value, min: s.min, max: s.max });
    }
  }
  if (!fields.length) throw new ScriptError(0, "declare at least one field");

  const derivs = stmts.filter((s) => s.k === "deriv");
  const assigns = stmts.filter((s) => s.k === "assign");
  const mode = derivs.length ? "deriv" : "assign";
  if (mode === "deriv" && assigns.some((a) => a.k === "assign" && fieldSet.has(a.name))) {
    throw new ScriptError(
      assigns.find((a) => a.k === "assign" && fieldSet.has(a.name))?.line ?? 0,
      "mixed styles: use name' = … for fields, or drop the primes for PDER 1.0 assignments",
    );
  }
  if (!derivs.length && !assigns.length) throw new ScriptError(0, "add an update equation");

  let bc: BC = "periodic";
  let view: string | null = null;
  for (const s of stmts) {
    if (s.k === "bc") bc = s.bc;
    if (s.k === "view") view = s.name;
  }

  const temps: string[] = [];
  const known = new Map<string, number>();
  fields.forEach((f, i) => known.set(f.name, i));

  const paramIndex = new Map<string, number>();
  params.forEach((p, i) => paramIndex.set(p.name, i));

  const ensureTemp = (name: string, line: number) => {
    if (known.has(name) || paramIndex.has(name)) return;
    if (mode === "deriv") throw new ScriptError(line, `unknown field ${name}`);
    if (name === "x" || name === "y" || name === "t") throw new ScriptError(line, `${name} is reserved`);
    known.set(name, known.size);
    temps.push(name);
  };

  // Temps are registered in assignment order so later lines can read them.
  const fieldKernels: Kernel[] = [];
  const scalarKernels: Kernel[] = [];
  if (mode === "assign") {
    for (const a of assigns) {
      if (a.k !== "assign") continue;
      const ops: Op[] = [];
      const spatial = new Set([...known.keys()]);
      const body = emitExpr(a.expr, a.line, known, paramIndex, ops, false, true);
      const isParam = paramIndex.has(a.name) && !known.has(a.name);
      if (!isParam) ensureTemp(a.name, a.line);
      if (isParam && usesSpatial(a.expr, spatial)) {
        throw new ScriptError(a.line, `${a.name} is a scalar parameter and can't take a field value`);
      }
      const k: Kernel = {
        line: a.line,
        lhs: a.name,
        kind: isParam ? "param" : "field",
        ops,
        fn: compileFn(body, a.line),
      };
      if (k.kind === "param") scalarKernels.push(k);
      else fieldKernels.push(k);
    }
  } else {
    for (const d of derivs) {
      if (d.k !== "deriv") continue;
      if (!known.has(d.name)) throw new ScriptError(d.line, `unknown field ${d.name}`);
      const ops: Op[] = [];
      const body = emitExpr(d.expr, d.line, known, paramIndex, ops, false, true);
      fieldKernels.push({ line: d.line, lhs: d.name, kind: "field", ops, fn: compileFn(body, d.line) });
    }
    for (const a of assigns) {
      if (a.k !== "assign") continue;
      const ops: Op[] = [];
      const body = emitExpr(a.expr, a.line, known, paramIndex, ops, false, true);
      if (!paramIndex.has(a.name)) throw new ScriptError(a.line, `unknown parameter ${a.name}`);
      if (usesSpatial(a.expr, new Set(known.keys()))) {
        throw new ScriptError(a.line, `${a.name} is a scalar parameter and can't take a field value`);
      }
      scalarKernels.push({ line: a.line, lhs: a.name, kind: "param", ops, fn: compileFn(body, a.line) });
    }
  }

  const ics = stmts
    .filter((s) => s.k === "ic")
    .map((s) => {
      if (s.k !== "ic") throw new ScriptError(0, "internal");
      if (!fields.some((f) => f.name === s.name)) throw new ScriptError(s.line, `unknown field ${s.name}`);
      const ops: Op[] = [];
      const body = emitExpr(s.expr, s.line, known, paramIndex, ops, true, false);
      if (ops.length) throw new ScriptError(s.line, "initial conditions can't use lap, dx, or dy");
      return { name: s.name, fn: compileFn(body, s.line) };
    });

  if (view && !known.has(view)) throw new ScriptError(0, `view ${view} is not a field`);
  if (!view) view = fields[0].name;

  const controls: ParamDef[] = params.map((p) => ({
    key: p.name,
    label: p.name,
    min: p.min,
    max: p.max,
    step: niceStep(p.min, p.max),
    value: p.value,
  }));

  return {
    bc,
    mode,
    fields,
    temps,
    params,
    controls,
    view,
    warnings,
    ics,
    fieldKernels,
    scalarKernels,
    colorHints,
  };
}

function niceStep(min: number, max: number) {
  const span = max - min;
  if (span <= 0) return 0.01;
  const raw = span / 200;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const snapped = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return snapped * pow;
}

export function applyOp(
  op: Op["op"],
  src: Float32Array,
  dst: Float32Array,
  n: number,
  bc: BC,
) {
  if (op === "lap") lap5(src, dst, n, bc);
  else if (op === "laplac") laplacLegacy(src, dst, n, bc);
  else if (op === "dx") derivX(src, dst, n, bc);
  else derivY(src, dst, n, bc);
}

export function noiseAt(i: number) {
  return hash01(i, 17);
}

export const SCRIPT_EXAMPLES: { id: string; label: string; source: string }[] = [
  {
    id: "pder2015",
    label: "2015 file",
    source: `## Variables
scalar box1 0
scalar box2 0
vector vect 1

## Constants
t 0
dt .01
k 2.0
tau 12

## Ranges
x 0 10 dim
y 0 10 dim
z 0 10 dim
box1 0 1 show
box2 0 1 show
dt .001 1 show
k 0.2 8 show
tau 0.5 40 show

## Equations
dbox1 = laplac(box1)
dbox2 = laplac(box2)
box1 = box1 + dbox1/k - box1/tau
box2 = box2 + dbox2/k - box2/tau
vect = vect + .01
t = t + dt

## files with initial values listed below
initial_test.txt
`,
  },
  {
    id: "heat",
    label: "Heat",
    source: `# Heat equation on the unit square.
# lap() is the five-point stencil in grid units, as in PDER 1.0.
field u = 0
param kappa = 0.18 [0.02, 0.24]
param dt = 1 [0.2, 1]

ic u = exp(-((x-0.35)^2+(y-0.55)^2)/0.008) + 0.7*exp(-((x-0.68)^2+(y-0.4)^2)/0.004)

u' = kappa * lap(u)
bc dirichlet
`,
  },
  {
    id: "gray",
    label: "Gray–Scott",
    source: `# Gray–Scott reaction–diffusion. Coral-like at these rates.
field u = 1
field v = 0
param Du = 0.16 [0.08, 0.22]
param Dv = 0.08 [0.04, 0.14]
param F = 0.0545 [0.01, 0.08]
param k = 0.062 [0.03, 0.07]
param dt = 1 [0.25, 1]

ic u = 1 - 0.5*step(0.012 - (x-0.5)^2 - (y-0.5)^2)
ic v = 0.25*step(0.012 - (x-0.5)^2 - (y-0.5)^2) + 0.02*noise()

u' = Du*lap(u) - u*v*v + F*(1-u)
v' = Dv*lap(v) + u*v*v - (F+k)*v
bc periodic
view v
`,
  },
  {
    id: "wave",
    label: "Wave",
    source: `# First-order form of the wave equation.
field u = 0
field w = 0
param c2 = 0.12 [0.02, 0.2]
param damp = 0.002 [0, 0.02]
param dt = 0.8 [0.2, 1]

ic u = exp(-((x-0.5)^2+(y-0.5)^2)/0.004)
ic w = 0

u' = w
w' = c2*lap(u) - damp*w
bc dirichlet
`,
  },
];
