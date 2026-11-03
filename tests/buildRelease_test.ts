import { assert, assertEquals } from "$std/assert/mod.ts";
import { join } from "$std/path/mod.ts";
import { pinBuildRelease, releaseAsset } from "../utils/buildRelease.ts";

Deno.test("rebuild cannot replace a running release; old tabs still load declared assets", async () => {
  const root = await Deno.makeTempDir({ prefix: "bude-release-test-" });
  try {
    await Deno.mkdir(join(root, "_fresh"));
    const old = "a".repeat(40), current = "b".repeat(40);
    const snapshot = (id: string) =>
      JSON.stringify({ build_id: id, files: { "chunk-OLD.js": [] } });
    await Deno.writeTextFile(join(root, "_fresh/snapshot.json"), snapshot(old));
    await Deno.writeTextFile(
      join(root, "_fresh/chunk-OLD.js"),
      "export const old = true;",
    );
    const pinned = await Promise.all([
      pinBuildRelease(root),
      pinBuildRelease(root),
    ]);
    assertEquals(pinned[0], pinned[1]);
    await Deno.writeTextFile(
      join(root, "_fresh/snapshot.json"),
      snapshot(current),
    );
    await Deno.writeTextFile(
      join(root, "_fresh/chunk-OLD.js"),
      "export const old = false;",
    );
    await pinBuildRelease(root);
    const req = new Request(
      `https://example.test/_frsh/js/${old}/chunk-OLD.js`,
    );
    const response = await releaseAsset(req, root);
    assert(response);
    assertEquals(await response.text(), "export const old = true;");
    assertEquals(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(
      await Deno.readTextFile(join(pinned[0], "chunk-OLD.js")),
      "export const old = true;",
    );
    for (
      const file of [
        "snapshot.json",
        "secret.js",
        "../snapshot.json",
        "%2e%2e%2fsnapshot.json",
      ]
    ) {
      assertEquals(
        await releaseAsset(
          new Request(`https://example.test/_frsh/js/${old}/${file}`),
          root,
        ),
        null,
      );
    }
    const head = await releaseAsset(new Request(req, { method: "HEAD" }), root);
    assertEquals(await head?.text(), "");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
