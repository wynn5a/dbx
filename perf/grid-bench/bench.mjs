// Drives the DataGrid bench harness (./harness.ts, built to ./dist) in a fresh
// headless Chrome over CDP. No external deps: Node 22's built-in WebSocket and
// fetch talk to the DevTools protocol directly.
//   node perf/grid-bench/bench.mjs [--quick] [--samples 3] [--keep]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL(".", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "shots");
mkdirSync(SHOTS, { recursive: true });

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const samplesArg = args.indexOf("--samples");
const SAMPLES = flag("--quick") ? 1 : samplesArg >= 0 ? Number(args[samplesArg + 1]) : 3;

const CHROME =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// --- static server ----------------------------------------------------------

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const httpPort = await new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const file = join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("nope");
    }
  });
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

// --- CDP client -------------------------------------------------------------

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data ?? ""})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });
  return {
    opened,
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close() {
      ws.close();
    },
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// --- chrome launch ----------------------------------------------------------

const profileDir = mkdtempSync(join(tmpdir(), "dbx-grid-bench-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=0`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,900",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--enable-precise-memory-info",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const exitPromise = new Promise((_, reject) => chrome.on("exit", (code) => reject(new Error(`chrome exited: ${code}`))));

let debuggerPort;
for (let i = 0; i < 100; i++) {
  try {
    debuggerPort = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n")[0];
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
if (!debuggerPort) throw new Error("DevToolsActivePort never appeared");
const targets = await (await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const cdp = connect(page.webSocketDebuggerUrl);
await cdp.opened;
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
await cdp.send("Profiler.enable");
await cdp.send("HeapProfiler.enable");

const consoleLines = [];
cdp.on("Runtime.consoleAPICalled", (params) => {
  const text = params.args.map((a) => a.value ?? a.description ?? "").join(" ");
  if (text.includes("[DBX]") || text.includes("Error") || text.includes("error")) {
    consoleLines.push(text.slice(0, 400));
  }
});
cdp.on("Runtime.exceptionThrown", (params) => {
  consoleLines.push(`EXCEPTION: ${JSON.stringify(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text).slice(0, 400)}`);
});

let loadWaiter = null;
cdp.on("Page.loadEventFired", () => {
  const w = loadWaiter;
  loadWaiter = null;
  w?.();
});
async function navigateAndWaitLoad(url) {
  const sent = cdp.send("Page.navigate", { url });
  await new Promise((resolve) => {
    loadWaiter = resolve;
  });
  await sent;
}

async function evaluate(expression, label, timeoutMs = 60000) {
  const result = await withTimeout(
    cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    timeoutMs,
    label,
  );
  if (result.exceptionDetails) {
    throw new Error(`${label}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function gcAndHeap() {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  return await evaluate("Math.round(performance.memory.usedJSHeapSize / 1048576)", "heap", 10000);
}

// --- profiling --------------------------------------------------------------

async function startProfile() {
  await cdp.send("Profiler.start");
}
async function stopProfile(file, topN = 14) {
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(join(ROOT, file), JSON.stringify(profile));
  const selfMicros = new Map();
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const delta = timeDeltas[i] ?? 0;
    selfMicros.set(samples[i], (selfMicros.get(samples[i]) ?? 0) + delta);
  }
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
  const agg = new Map();
  for (const [nodeId, micros] of selfMicros) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const cf = node.callFrame;
    const url = (cf.url ?? "").replace(/^.*\/(src|node_modules)\//, "$1/");
    const key = `${cf.functionName || "(anonymous)"} @ ${url}:${cf.lineNumber + 1}`;
    agg.set(key, (agg.get(key) ?? 0) + micros);
  }
  const total = [...agg.values()].reduce((a, b) => a + b, 0) || 1;
  return [...agg]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, micros]) => ({ selfMs: Math.round(micros / 10) / 100, pct: Math.round((micros / total) * 1000) / 10, fn: key }));
}

// --- scenarios --------------------------------------------------------------

const CANVAS_GEOS = [
  { rows: 1000, cols: 20 },
  { rows: 10000, cols: 20 },
  { rows: 100000, cols: 20 },
  { rows: 10000, cols: 100 },
];
const DOM_GEOS = [{ rows: 10000, cols: 20 }];

const CANVAS_OPS = [
  ["scrollVertical", "window.__bench.scrollVertical()"],
  ["scrollHorizontal", "window.__bench.scrollHorizontal()"],
  ["searchNarrow", "window.__bench.search()"],
  ["searchWarmPrefix", "window.__bench.searchWarmPrefix()"],
  ["searchWarmFull", "window.__bench.searchWarmFull()"],
  ["clearSearch", "window.__bench.clearSearch()"],
  ["searchBroad", "window.__bench.searchBroad()"],
  ["clearSearch2", "window.__bench.clearSearch()"],
  ["selectDrag120", "window.__bench.selectDrag()"],
  ["toggleColumn", "window.__bench.toggleColumn()"],
  ["resizeColumn", "window.__bench.resizeColumn()"],
  ["replaceResult", "window.__bench.replaceResult()"],
];
const DOM_OPS = [
  ["scrollVertical", "window.__bench.scrollVertical()"],
  ["searchNarrow", "window.__bench.search()"],
  ["searchWarmPrefix", "window.__bench.searchWarmPrefix()"],
  ["searchWarmFull", "window.__bench.searchWarmFull()"],
  ["clearSearch", "window.__bench.clearSearch()"],
  ["searchBroad", "window.__bench.searchBroad()"],
  ["clearSearch2", "window.__bench.clearSearch()"],
  ["replaceResult", "window.__bench.replaceResult()"],
];

const results = [];

async function runSample(geo, mode, sampleIndex) {
  const label = `${mode}-${geo.rows}x${geo.cols}`;
  const query = `http://127.0.0.1:${httpPort}/?rows=${geo.rows}&cols=${geo.cols}&mode=${mode}&seed=${42 + sampleIndex}`;
  let ready, profileTop = null;
  if (mode === "canvas" && sampleIndex === 1) {
    await startProfile();
  }
  await navigateAndWaitLoad(query);
  ready = await withTimeout(
    (async () => {
      // harness mounts at module eval; __bench appears after first frame
      for (let i = 0; i < 200; i++) {
        const has = await evaluate("typeof window.__bench !== 'undefined'", "probe", 5000).catch(() => false);
        if (has) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return evaluate("window.__bench.ready()", "ready", 30000);
    })(),
    90000,
    `page load + ready ${label}`,
  );
  if (mode === "canvas" && sampleIndex === 1) {
    await new Promise((r) => setTimeout(r, 1000));
    profileTop = { mount: await stopProfile(`profile-${label}-mount.cpuprofile`) };
    await startProfile();
  }

  const ops = {};
  const opList = mode === "canvas" ? CANVAS_OPS : DOM_OPS;
  for (const [name, expr] of opList) {
    if (mode === "canvas" && sampleIndex === 1) {
      if (name === "scrollVertical") {
        ops[name] = await evaluate(expr, name);
        profileTop.scroll = await stopProfile(`profile-${label}-scroll.cpuprofile`);
        await startProfile();
      } else if (name === "searchNarrow") {
        ops[name] = await evaluate(expr, name);
        profileTop.search = await stopProfile(`profile-${label}-search.cpuprofile`);
        await startProfile();
      }
    }
    ops[name] = ops[name] ?? (await evaluate(expr, name, 120000));
    if (sampleIndex === 0 && name === "selectDrag120") {
      await screenshot(`${label}-after-select`);
    }
  }
  if (mode === "canvas" && sampleIndex === 1) {
    profileTop.tail = await stopProfile(`profile-${label}-tail.cpuprofile`);
  }
  if (sampleIndex === 0) {
    await screenshot(`${label}-after-ops`);
  }
  const heapMiB = await gcAndHeap();
  const info = await evaluate("window.__bench.info()", "info", 10000);
  const row = { label, mode, geo, sample: sampleIndex, ready, ops, heapMiB, info };
  if (profileTop) row.profiles = profileTop;
  results.push(row);
  console.log(
    `[${label} #${sampleIndex}] firstFrame=${ready.firstFrameMs}ms scroll.wall=${ops.scrollVertical?.wallMs ?? "-"}ms ` +
      `scroll.p95=${ops.scrollVertical?.frames?.p95Ms ?? "-"}ms search.wall=${ops.searchNarrow?.wallMs ?? "-"}ms heap=${heapMiB}MiB`,
  );
}

for (const geo of CANVAS_GEOS) {
  for (let s = 0; s < SAMPLES; s++) {
    await exitPromiseOrDelay(runSample(geo, "canvas", s));
  }
}
for (const geo of DOM_GEOS) {
  for (let s = 0; s < SAMPLES; s++) {
    await exitPromiseOrDelay(runSample(geo, "dom", s));
  }
}

async function exitPromiseOrDelay(p) {
  await Promise.race([p, exitPromise]);
}

// Heap probes run in a dedicated fresh Chrome per config so V8 heap sizing
// shared with the timing run can't inflate the footprint numbers.
async function heapProbe(geo, mode) {
  const probeProfile = mkdtempSync(join(tmpdir(), "dbx-grid-heap-"));
  const probeChrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${probeProfile}`,
      "--window-size=1440,900",
      "--no-first-run",
      "--disable-extensions",
      "--enable-precise-memory-info",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    let probePort;
    for (let i = 0; i < 100; i++) {
      try {
        probePort = readFileSync(join(probeProfile, "DevToolsActivePort"), "utf8").split("\n")[0];
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const targets = await (await fetch(`http://127.0.0.1:${probePort}/json/list`)).json();
    const pc = connect(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await pc.opened;
    await pc.send("Runtime.enable");
    await pc.send("Page.enable");
    await pc.send("HeapProfiler.enable");
    const evaluateOn = async (expression) => {
      const result = await withTimeout(
        pc.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
        60000,
        expression,
      );
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "eval failed");
      return result.result.value;
    };
    await pc.send("Page.navigate", {
      url: `http://127.0.0.1:${httpPort}/?rows=${geo.rows}&cols=${geo.cols}&mode=${mode}`,
    });
    for (let i = 0; i < 200 && !(await evaluateOn("typeof window.__bench !== 'undefined'").catch(() => false)); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await evaluateOn("window.__bench.ready()");
    await pc.send("HeapProfiler.collectGarbage");
    await pc.send("HeapProfiler.collectGarbage");
    await new Promise((r) => setTimeout(r, 300));
    const mib = await evaluateOn("Math.round(performance.memory.usedJSHeapSize / 1048576)");
    pc.close();
    return mib;
  } finally {
    probeChrome.kill();
  }
}

const heapFootprints = {};
for (const geo of CANVAS_GEOS) {
  heapFootprints[`canvas-${geo.rows}x${geo.cols}`] = await heapProbe(geo, "canvas");
  console.log(`heap[canvas-${geo.rows}x${geo.cols}] = ${heapFootprints[`canvas-${geo.rows}x${geo.cols}`]} MiB`);
}
for (const geo of DOM_GEOS) {
  heapFootprints[`dom-${geo.rows}x${geo.cols}`] = await heapProbe(geo, "dom");
  console.log(`heap[dom-${geo.rows}x${geo.cols}] = ${heapFootprints[`dom-${geo.rows}x${geo.cols}`]} MiB`);
}

writeFileSync(join(ROOT, "results.json"), JSON.stringify({ samples: results, heapFootprints }, null, 2));
console.log(`\n${results.length} samples -> perf/grid-bench/results.json`);
if (consoleLines.length) {
  console.log(`\nconsole highlights (${consoleLines.length} lines, first 15):`);
  for (const line of consoleLines.slice(0, 15)) console.log("  " + line);
}
cdp.close();
chrome.kill();
process.exit(0);
