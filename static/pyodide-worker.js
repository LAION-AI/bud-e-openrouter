/**
 * pyodide-worker.js
 *
 * Runs the notebook's Python in a Web Worker so a runaway loop freezes only
 * the interpreter, never the page. One worker holds one interpreter, and the
 * cells of a notebook share it - exactly like a Jupyter kernel.
 *
 * Plain JavaScript on purpose: it is served straight from /static and loaded
 * with `new Worker(...)`, so it never goes through the bundler.
 *
 * Messages in
 *   {type:"init",  indexURL}
 *   {type:"run",   id, code}
 *   {type:"interrupt"}
 * Messages out
 *   {type:"status",  text}          progress while booting or loading packages
 *   {type:"ready",   version}
 *   {type:"stdout",  id, text}
 *   {type:"stderr",  id, text}
 *   {type:"image",   id, data}      base64 PNG from matplotlib
 *   {type:"result",  id, text}      repr of the last expression
 *   {type:"error",   id, text}
 *   {type:"done",    id}
 *   {type:"fatal",   text}
 */

let pyodide = null;
let interruptBuffer = null;

/**
 * Import name -> Pyodide package name, where the two differ.
 * Anything not listed is tried under its own name.
 */
const PACKAGE_ALIASES = {
  sklearn: "scikit-learn",
  skimage: "scikit-image",
  PIL: "pillow",
  cv2: "opencv-python",
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
  dateutil: "python-dateutil",
  serial: "pyserial",
  OpenSSL: "pyopenssl",
  Crypto: "pycryptodome",
  mpl_toolkits: "matplotlib",
};

/** Standard library - never a package to download. */
const STDLIB = new Set([
  "abc", "argparse", "array", "ast", "asyncio", "base64", "binascii", "bisect",
  "builtins", "calendar", "cmath", "collections", "colorsys", "contextlib",
  "copy", "csv", "ctypes", "dataclasses", "datetime", "decimal", "difflib",
  "enum", "fractions", "functools", "gc", "getpass", "glob", "gzip", "hashlib",
  "heapq", "hmac", "html", "http", "importlib", "inspect", "io", "itertools",
  "json", "logging", "math", "operator", "os", "pathlib", "pickle", "platform",
  "pprint", "queue", "random", "re", "secrets", "shutil", "signal", "site",
  "socket", "sqlite3", "statistics", "string", "struct", "subprocess", "sys",
  "tempfile", "textwrap", "threading", "time", "timeit", "tokenize", "traceback",
  "types", "typing", "unicodedata", "unittest", "urllib", "uuid", "warnings",
  "weakref", "xml", "zipfile", "zlib",
]);

/** Top-level module names a snippet imports. */
function importedModules(code) {
  const found = new Set();
  const patterns = [
    /^[ \t]*import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*)/gm,
    /^[ \t]*from[ \t]+([A-Za-z_][\w.]*)[ \t]+import/gm,
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(code)) !== null) {
      for (const part of m[1].split(",")) {
        const top = part.trim().split(".")[0].trim();
        if (top && !STDLIB.has(top)) found.add(top);
      }
    }
  }
  return [...found];
}

/**
 * Loads what the code imports.
 *
 * Pyodide's own loadPackagesFromImports resolves "import numpy" to the
 * numpy-tests package in 0.29, which installs an empty numpy namespace and
 * makes np.arange vanish. Resolving the names here avoids that, and skips the
 * multi-megabyte -tests wheels nobody wants in a classroom.
 */
async function loadImports(code, id) {
  const modules = importedModules(code);
  for (const module of modules) {
    const name = PACKAGE_ALIASES[module] ?? module;
    if (pyodide.loadedPackages[name]) continue;
    try {
      self.postMessage({ type: "status", text: "packages:" + name });
      await pyodide.loadPackage(name, { messageCallback: () => {} });
    } catch {
      // Not part of the distribution. Either it is pure Python and the pupil
      // installs it with micropip, or the import below fails with a plain
      // ModuleNotFoundError - both are clearer than anything we could invent.
    }
  }
}

/**
 * Splits code into the parts that are real Python and the parts inside a
 * string or comment. Used so a rewrite never touches text the pupil typed
 * inside quotes.
 */
function pythonSegments(code) {
  const segments = [];
  let i = 0;
  let plain = "";
  while (i < code.length) {
    const ch = code[i];
    if (ch === "#") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      segments.push({ code: plain }, { literal: code.slice(i, stop) });
      plain = "";
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = code.slice(i, i + 3);
      const quote = (triple === '"""' || triple === "'''") ? triple : ch;
      let j = i + quote.length;
      while (j < code.length) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code.startsWith(quote, j)) {
          j += quote.length;
          break;
        }
        // An unterminated single-quoted string ends at the line break.
        if (quote.length === 1 && code[j] === "\n") break;
        j++;
      }
      segments.push({ code: plain }, { literal: code.slice(i, j) });
      plain = "";
      i = j;
      continue;
    }
    plain += ch;
    i++;
  }
  segments.push({ code: plain });
  return segments;
}

/** Applies a replacement to the Python parts only. */
function rewriteCodeOnly(code, replacer) {
  return pythonSegments(code)
    .map((s) => (s.literal !== undefined ? s.literal : replacer(s.code)))
    .join("");
}

/**
 * Turns `input(...)` into `await __bude_input(...)`.
 *
 * The alternative would be blocking the worker on a SharedArrayBuffer, which
 * needs the whole site to be cross-origin isolated. Awaiting works because
 * runPythonAsync supports top-level await and still assigns to the shared
 * globals, so the cells keep sharing their variables.
 *
 * The catch: `await` is illegal inside a plain `def`, so input() inside a
 * function raises a SyntaxError. run() turns that into a readable hint.
 */
function rewriteInput(code) {
  if (!/\binput\s*\(/.test(code)) return { code, usesInput: false };
  let usesInput = false;
  const out = rewriteCodeOnly(code, (part) =>
    part.replace(/(^|[^\w.])input\s*\(/g, (_all, before) => {
      usesInput = true;
      return `${before}await __bude_input(`;
    }));
  return { code: out, usesInput };
}

/**
 * Colab-style `!command` lines. Only package installs are meaningful in the
 * browser - there is no shell here - so those are mapped onto micropip and
 * everything else gets an explanation instead of a confusing failure.
 */
function rewriteBangLines(code) {
  const wanted = new Set();
  const lines = code.split("\n").map((line) => {
    const m = /^(\s*)!\s*(.+?)\s*$/.exec(line);
    if (!m) return line;
    const [, indent, command] = m;

    const install = /^(?:pip3?|python3?\s+-m\s+pip)\s+install\s+(.+)$/.exec(command);
    if (install) {
      const packages = install[1]
        .split(/\s+/)
        .filter((p) => p && !p.startsWith("-"));
      for (const p of packages) wanted.add(p);
      return `${indent}await __bude_pip(${JSON.stringify(packages)})`;
    }
    return `${indent}__bude_no_shell(${JSON.stringify(command)})`;
  });
  return { code: lines.join("\n"), installs: [...wanted] };
}

/** Pulls any matplotlib figures out as PNGs and clears them. */
const COLLECT_FIGURES = `
def __bude_collect_figures():
    import sys
    if "matplotlib.pyplot" not in sys.modules:
        return []
    import base64, io
    plt = sys.modules["matplotlib.pyplot"]
    out = []
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png", bbox_inches="tight", dpi=110)
        out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out
`;

/** Resolvers for input() calls waiting on an answer from the page. */
const pendingInputs = new Map();
let inputSeq = 0;

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "init") return await init(msg.indexURL);
    if (msg.type === "run") return await run(msg.id, msg.code);
    if (msg.type === "input-response") {
      const resolve = pendingInputs.get(msg.inputId);
      if (resolve) {
        pendingInputs.delete(msg.inputId);
        resolve(msg.cancelled ? null : String(msg.value ?? ""));
      }
      return;
    }
    if (msg.type === "interrupt") {
      // Only works when the page is cross-origin isolated; otherwise the UI
      // falls back to terminating this worker.
      if (interruptBuffer) interruptBuffer[0] = 2; // SIGINT
      return;
    }
  } catch (error) {
    self.postMessage({ type: "fatal", text: describe(error) });
  }
};

async function init(indexURL) {
  self.postMessage({ type: "status", text: "loading" });
  importScripts(indexURL + "pyodide.js");

  pyodide = await loadPyodide({
    indexURL,
    stdout: (text) => self.postMessage({ type: "stdout", id: currentId, text: text + "\n" }),
    stderr: (text) => self.postMessage({ type: "stderr", id: currentId, text: text + "\n" }),
  });

  // Asks the page for one line of input; null means the pupil hit cancel.
  self.__bude_ask = (prompt) => {
    const inputId = ++inputSeq;
    return new Promise((resolve) => {
      pendingInputs.set(inputId, resolve);
      self.postMessage({
        type: "input",
        id: currentId,
        inputId,
        prompt: String(prompt ?? ""),
      });
    });
  };

  // A non-interactive backend, otherwise pyplot looks for a display.
  await pyodide.runPythonAsync(
    'import os\nos.environ.setdefault("MPLBACKEND", "AGG")\n' + COLLECT_FIGURES + `
import js as __bude_js

async def __bude_input(prompt=""):
    """Stand-in for input(): asks the page and echoes like a terminal would."""
    text = str(prompt)
    if text:
        print(text, end="")
    answer = await __bude_js.__bude_ask(text)
    if answer is None:
        raise KeyboardInterrupt("Eingabe abgebrochen")
    print(answer)
    return answer

async def __bude_pip(packages):
    """Backs the Colab-style '!pip install ...' line."""
    import micropip
    for name in packages:
        print("Installiere " + name + " ...")
        await micropip.install(name)
    print("Fertig. Die Pakete lassen sich jetzt importieren.")

def __bude_no_shell(command):
    raise RuntimeError(
        "Hier läuft kein Terminal - nur '!pip install <paket>' wird "
        "unterstützt. Nicht ausführbar: " + command
    )
`,
  );

  try {
    interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    pyodide.setInterruptBuffer(interruptBuffer);
  } catch {
    // No SharedArrayBuffer without cross-origin isolation - stop falls back
    // to killing the worker, which the UI handles.
    interruptBuffer = null;
  }

  self.postMessage({
    type: "ready",
    version: pyodide.version,
    canInterrupt: !!interruptBuffer,
  });
}

let currentId = null;

async function run(id, rawCode) {
  currentId = id;
  if (!pyodide) {
    self.postMessage({ type: "error", id, text: "Interpreter is not ready yet." });
    self.postMessage({ type: "done", id });
    return;
  }
  if (interruptBuffer) interruptBuffer[0] = 0;

  const bang = rewriteBangLines(rawCode);
  const { code, usesInput } = rewriteInput(bang.code);

  try {
    // Pulls in numpy, pandas, matplotlib and friends when the code imports
    // them.
    await loadImports(rawCode, id);
    if (bang.installs.length > 0) await pyodide.loadPackage("micropip");
    self.postMessage({ type: "status", text: "running" });

    const result = await pyodide.runPythonAsync(code);

    // Figures first: they belong above the return value, as in Jupyter.
    await emitFigures(id);

    if (result !== undefined && result !== null) {
      let text;
      try {
        text = typeof result === "object" && typeof result.toString === "function"
          ? result.toString()
          : String(result);
      } catch {
        text = "<unrepresentable value>";
      }
      if (result && typeof result.destroy === "function") result.destroy();
      if (text !== "None" && text !== "undefined") {
        self.postMessage({ type: "result", id, text });
      }
    }
  } catch (error) {
    // A figure drawn before the exception is still worth showing.
    await emitFigures(id).catch(() => {});
    self.postMessage({ type: "error", id, text: explain(error, usesInput) });
  } finally {
    // A cell that ended while an input was still open must not leave the
    // page waiting for an answer nobody will use.
    for (const [inputId] of pendingInputs) {
      self.postMessage({ type: "input-cancel", id, inputId });
    }
    pendingInputs.clear();
    self.postMessage({ type: "done", id });
    self.postMessage({ type: "status", text: "idle" });
    currentId = null;
  }
}

async function emitFigures(id) {
  const figures = await pyodide.runPythonAsync("__bude_collect_figures()");
  if (!figures) return;
  const list = typeof figures.toJs === "function"
    ? figures.toJs({ create_proxies: false })
    : figures;
  for (const data of list) self.postMessage({ type: "image", id, data });
  if (typeof figures.destroy === "function") figures.destroy();
}

/**
 * Python errors arrive with the whole JS wrapper attached. The traceback the
 * pupil needs is the Python part, so strip the rest.
 */
function describe(error) {
  const raw = error && error.message ? error.message : String(error);
  const start = raw.indexOf("Traceback (most recent call last)");
  const text = start >= 0 ? raw.slice(start) : raw;
  return text
    .replace(/^\s*File "<exec>", line (\d+).*$/gm, "  Zeile $1")
    .replace(/^\s*File "\/lib\/python[^"]*".*$/gm, "")
    .replace(/^\s*File "\/lib\/python[^"]*"[\s\S]*?micropip[^\n]*$/gm, "")
    .replace(/\bawait __bude_input\(/g, "input(")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * Adds a hint for the one case the input() rewrite cannot cover: `await` is
 * not allowed inside a plain `def`, so input() in a function fails to compile.
 * Without this the pupil would see a traceback about `await`, which they never
 * typed.
 */
function explain(error, usesInput) {
  const text = describe(error);
  if (usesInput && /'await' outside (async )?function/.test(text)) {
    return (
      "input() kann hier nur außerhalb von Funktionen benutzt werden.\n" +
      "Frag die Eingabe vor dem Funktionsaufruf ab und übergib sie als " +
      "Parameter:\n\n" +
      "    name = input(\"Wie heißt du? \")\n" +
      "    begrüße(name)\n"
    );
  }
  if (/KeyboardInterrupt: Eingabe abgebrochen/.test(text)) {
    return "Eingabe abgebrochen.";
  }
  return text;
}
