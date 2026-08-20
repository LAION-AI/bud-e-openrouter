/**
 * @file fetch-pyodide.ts
 * @description Downloads the Python runtime into static/pyodide/, so the
 *              browser gets it from this server instead of a CDN.
 *
 *              Run with: deno task pyodide
 *
 *              Why bother: the notebook needs about 12 MB before it can start.
 *              Over a slow link to a CDN that can take minutes; from the server
 *              the page is already talking to, it takes seconds. It also means
 *              the notebook works in a school with no internet.
 *
 *              Only the core is fetched. The 358 packages stay on the CDN and
 *              are pulled in only when a program actually imports them -
 *              mirroring all of them would be over 300 MB for something most
 *              lessons never touch.
 */

const VERSION = Deno.args[0] ?? "0.29.0";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const TARGET = new URL("../static/pyodide/", import.meta.url).pathname;

/** Everything loadPyodide needs before it can run a single line of Python. */
const CORE_FILES = [
  "pyodide.js",
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  console.log(`Pyodide ${VERSION} -> ${TARGET}`);
  await Deno.mkdir(TARGET, { recursive: true });

  let total = 0;
  for (const file of CORE_FILES) {
    const started = performance.now();
    const res = await fetch(CDN + file);
    if (!res.ok) {
      // pyodide.mjs does not exist in every release; the rest is mandatory.
      if (file === "pyodide.mjs") {
        console.log(`  skipped ${file} (not in this release)`);
        continue;
      }
      console.error(`  FAILED ${file}: HTTP ${res.status}`);
      Deno.exit(1);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    await Deno.writeFile(TARGET + file, bytes);
    total += bytes.length;
    const seconds = (performance.now() - started) / 1000;
    console.log(
      `  ${file.padEnd(20)} ${mb(bytes.length).padStart(7)} MB  ${
        seconds.toFixed(1)
      }s`,
    );
  }

  console.log(`\n${mb(total)} MB written.`);
  console.log(
    "The notebook picks this up on its own - it checks for /pyodide/ and\n" +
      "falls back to the CDN when the folder is not there.",
  );
}

if (import.meta.main) await main();
