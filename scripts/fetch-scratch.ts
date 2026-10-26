/** Pin and self-host the official standalone build and its read-only libraries.
 * Run: deno run -A scripts/fetch-scratch.ts [already-extracted npm package]
 * No student projects or credentials are read by this build-time script.
 */
const VERSION = "15.2.0";
const REVISION = "970132883d63286762783448d4d487dcefedabf8";
const INTEGRITY =
  "ZjKknkK6Suh0qtfCgaKNUt2Ilz/j6pWdTn6+Brrb2NLn8iXviccLfiSezAFvXqFqWaOMjac0sMfe8JpKkkOPTg==";
const root = new URL("../", import.meta.url).pathname;
const out = root + "static/scratch/";
let source = Deno.args[0];
if (!source) {
  const temp = await Deno.makeTempDir({ prefix: "bude-scratch-" });
  const archive = new Uint8Array(
    await (await fetch(
      `https://registry.npmjs.org/@scratch/scratch-gui/-/scratch-gui-${VERSION}.tgz`,
    )).arrayBuffer(),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-512", archive));
  const encoded = btoa(
    Array.from(hash, (n) => String.fromCharCode(n)).join(""),
  );
  if (encoded !== INTEGRITY) {
    throw new Error("Scratch-Paket: Integritätsprüfung fehlgeschlagen.");
  }
  await Deno.writeFile(temp + "/package.tgz", archive);
  const result = await new Deno.Command("tar", {
    args: ["-xzf", temp + "/package.tgz", "-C", temp],
  }).output();
  if (!result.success) {
    throw new Error("Scratch-Paket konnte nicht entpackt werden.");
  }
  source = temp + "/package";
}
const metadata = JSON.parse(await Deno.readTextFile(source + "/package.json"));
if (metadata.name !== "@scratch/scratch-gui" || metadata.version !== VERSION) {
  throw new Error("Falsches Scratch-Paket.");
}
await Deno.mkdir(out + "vendor", { recursive: true });
await Deno.mkdir(out + "library-assets", { recursive: true });
for (const path of ["static", "chunks"]) {
  const copy = await new Deno.Command("cp", {
    args: ["-R", source + "/dist/" + path, out + "vendor/"],
  }).output();
  if (!copy.success) {
    throw new Error("Scratch-Dateien konnten nicht kopiert werden.");
  }
}
// Relocate the two public paths in the pinned published UMD bundle.
const originalBundle = await Deno.readTextFile(
  source + "/dist/scratch-gui-standalone.js",
);
const publicPaths =
  /(__webpack_require__|__nested_webpack_require_\d+__)\.p="\/"/g;
if ([...originalBundle.matchAll(publicPaths)].length !== 2) {
  throw new Error("Scratch-Bundle: unerwartete öffentliche Pfade.");
}
await Deno.writeTextFile(
  out + "vendor/scratch-gui-standalone.js",
  originalBundle.replace(publicPaths, '$1.p="/scratch/vendor/"'),
);
await Deno.copyFile(source + "/LICENSE", out + "LICENSE.txt");
await Deno.copyFile(source + "/TRADEMARK", out + "TRADEMARK.txt");
await Deno.writeTextFile(
  out + "NOTICE.txt",
  `Block-Editor auf Basis von Scratch\n\nOriginal: Scratch Foundation, @scratch/scratch-gui ${VERSION}\nUnveränderter offizieller Standalone-Build. Lizenz: AGPL-3.0-only (siehe LICENSE.txt).\nScratch und seine Figuren sind Marken der Scratch Foundation. Keine Empfehlung oder Partnerschaft durch die Scratch Foundation.\n\nUpstream-Quellcode einschließlich Build-Konfiguration und Abhängigkeiten:\nhttps://github.com/scratchfoundation/scratch-editor/tree/${REVISION}\nhttps://github.com/scratchfoundation/scratch-editor/archive/${REVISION}.tar.gz\n\nQuellcode dieser Einbettung und Bauanleitung: /scratch/integration-source.tar.gz\nBrowser-Brücke: /scratch/bootstrap.js\n\nDie Standardbibliothek wird unverändert von assets.scratch.mit.edu bezogen und lokal bereitgestellt. Alle Rechte und Hinweise der Originaldateien gelten weiter.\nKeine Scratch-Anmeldung, kein Cloud-Speichern und kein Projekt-Upload. Projektdateien bleiben im Browser. Nur nach Freigabe wird ein begrenzter Code-Ausschnitt an den konfigurierten KI-Anbieter geschickt.\n`,
);
await Deno.writeTextFile(
  out + "NOTICE.txt",
  (await Deno.readTextFile(out + "NOTICE.txt"))
    .replace(
      "Unveränderter offizieller Standalone-Build.",
      "Offizieller Standalone-Build; zwei statische webpack-Pfade nach /scratch/vendor/ verlegt (siehe fetch-scratch.ts).",
    ),
);
const assets = new Set<string>();
const library = {
  sprites: JSON.parse(
    await Deno.readTextFile(`${source}/dist/libraries/sprites.json`),
  ),
  backdrops: JSON.parse(
    await Deno.readTextFile(`${source}/dist/libraries/backdrops.json`),
  ),
};
await Deno.writeTextFile(out + "library.json", JSON.stringify(library));
function collect(value: unknown) {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.md5ext === "string" &&
    /^[a-f0-9]{32}\.(svg|png|jpg|wav|mp3)$/.test(record.md5ext)
  ) assets.add(record.md5ext);
  for (const item of Object.values(record)) collect(item);
}
for (const name of ["sprites", "costumes", "sounds", "backdrops"]) {
  collect(
    JSON.parse(
      await Deno.readTextFile(`${source}/dist/libraries/${name}.json`),
    ),
  );
}
let completed = 0;
const queue = [...assets];
const failures: string[] = [];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const name = queue.pop()!;
    try {
      if ((await Deno.stat(out + "library-assets/" + name)).size) {
        completed++;
        continue;
      }
    } catch { /* Download absent asset. */ }
    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          `https://assets.scratch.mit.edu/internalapi/asset/${name}/get/`,
          { signal: AbortSignal.timeout(30_000) },
        );
        if (!response.ok) {
          await response.body?.cancel();
          continue;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 20_000_000) {
          throw new Error("Ungültige Bibliotheksdatei.");
        }
        await Deno.writeFile(out + "library-assets/" + name, bytes);
        success = true;
        break;
      } catch { /* Bounded retry; no silent missing files. */ }
    }
    if (!success) failures.push(name);
    completed++;
    if (completed % 200 === 0) {
      console.log(`Scratch-Bibliothek: ${completed}/${assets.size}`);
    }
  }
}));
if (failures.length) {
  throw new Error(
    `Scratch-Bibliothek: ${failures.length} fehlende Dateien: ${
      failures.slice(0, 10).join(", ")
    }`,
  );
}
console.log(
  `Scratch ${VERSION}: Standalone-Build und ${assets.size} Bibliotheksdateien lokal bereit.`,
);
// Publish only explicit integration sources, never project databases or credentials.
const integrationSource = await new Deno.Command("tar", {
  cwd: root,
  args: [
    "-czf",
    out + "integration-source.tar.gz",
    "SCRATCH.md",
    "scripts/fetch-scratch.ts",
    "static/scratch/bootstrap.js",
    "static/scratch/blocks.js",
    "utils/scratchTools.ts",
    "utils/scratchSession.ts",
    "utils/scratchReply.ts",
    "components/ScratchModal.tsx",
    "components/MarkdownText.tsx",
    "components/ClassroomCodeContent.tsx",
    "components/ChatTemplate.tsx",
    "islands/ChatIsland.tsx",
    "islands/ClassroomChat.tsx",
    "utils/classroomEditorTools.ts",
    "routes/scratch-editor.ts",
    "routes/api/chat.ts",
    "routes/api/classroom.ts",
    "tests/scratchTools_test.ts",
    "tests/scratchApi_test.ts",
    "tests/scratchReply_test.ts",
    "tests/markdown_test.tsx",
    "tests/scratchBrowser_test.py",
    "tests/scratchGameBrowser_test.py",
    "deno.json",
    "fresh.gen.ts",
  ],
}).output();
if (!integrationSource.success) {
  throw new Error("Scratch-Einbettungsquelle konnte nicht gepackt werden.");
}
