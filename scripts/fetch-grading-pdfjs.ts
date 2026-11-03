/** Self-hosted PDF renderer. No pupil document is sent to a rendering service.
 * Run once after checkout: deno run -A scripts/fetch-grading-pdfjs.ts */
const VERSION = "5.4.624";
const INTEGRITY =
  "sm6TxKTtWv1Oh6n3C6J6a8odejb5uO4A4zo/2dgkHuC0iu8ZMAXOezEODkVaoVp8nX1Xzr+0WxFJJmUr45hQzg==";
const target = new URL(`../static/pdfjs/${VERSION}/`, import.meta.url).pathname;
const response = await fetch(
  `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${VERSION}.tgz`,
);
if (!response.ok) throw new Error(`PDF.js download: HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
if (btoa(String.fromCharCode(...digest)) !== INTEGRITY) {
  throw new Error("PDF.js integrity mismatch");
}
const temp = await Deno.makeTempDir({ prefix: "grading-pdfjs-" });
try {
  await Deno.writeFile(`${temp}/package.tgz`, bytes);
  await Deno.mkdir(target, { recursive: true });
  const result = await new Deno.Command("tar", {
    args: [
      "-xzf",
      `${temp}/package.tgz`,
      "-C",
      target,
      "--strip-components=1",
      "package/build/pdf.min.mjs",
      "package/build/pdf.worker.min.mjs",
      "package/cmaps",
      "package/standard_fonts",
      "package/wasm",
      "package/LICENSE",
    ],
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  console.log(`PDF.js ${VERSION} installed locally (integrity verified).`);
} finally {
  await Deno.remove(temp, { recursive: true });
}
