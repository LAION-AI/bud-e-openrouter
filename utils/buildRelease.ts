/** Keep each running Fresh worker on immutable assets, even during a rebuild. */
import { copy } from "$std/fs/copy.ts";
import { join } from "$std/path/mod.ts";

type Snapshot = { build_id: string; files: Record<string, string[]> };
const BUILD_ID = /^[a-f0-9]{40}$/;

export async function pinBuildRelease(root: string): Promise<string> {
  const source = join(root, "_fresh");
  const snapshot: Snapshot = JSON.parse(
    await Deno.readTextFile(join(source, "snapshot.json")),
  );
  if (!BUILD_ID.test(snapshot.build_id)) {
    throw new Error("Invalid Fresh build ID");
  }
  const archive = join(root, ".fresh-releases");
  const release = join(archive, snapshot.build_id);
  try {
    await Deno.stat(join(release, "snapshot.json"));
    return release;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(archive, { recursive: true });
  const temporary = await Deno.makeTempDir({
    dir: archive,
    prefix: "preparing-",
  });
  try {
    await copy(source, temporary, { overwrite: true });
    // Never publish a partially copied snapshot. A concurrent worker may win.
    const copied: Snapshot = JSON.parse(
      await Deno.readTextFile(join(temporary, "snapshot.json")),
    );
    if (copied.build_id !== snapshot.build_id) {
      throw new Error(
        "Build changed while starting; retry after the build completes",
      );
    }
    for (const name of Object.keys(copied.files)) {
      await Deno.stat(join(temporary, name));
    }
    try {
      await Deno.rename(temporary, release);
    } catch (error) {
      const existing = await Deno.readTextFile(join(release, "snapshot.json"))
        .catch(() => "");
      if (!existing || JSON.parse(existing).build_id !== snapshot.build_id) {
        throw error;
      }
    }
  } finally {
    await Deno.remove(temporary, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
  return release;
}

/** Old tabs may still request their previous build. Only serve declared JS. */
export async function releaseAsset(
  req: Request,
  root: string,
): Promise<Response | null> {
  const match = /^\/_frsh\/js\/([a-f0-9]{40})\/([a-zA-Z0-9_-]+\.js)$/.exec(
    new URL(req.url).pathname,
  );
  if (!match || !["GET", "HEAD"].includes(req.method)) return null;
  const [, id, name] = match;
  const release = join(root, ".fresh-releases", id);
  try {
    const snapshot: Snapshot = JSON.parse(
      await Deno.readTextFile(join(release, "snapshot.json")),
    );
    if (snapshot.build_id !== id || !Object.hasOwn(snapshot.files, name)) {
      return null;
    }
    const file = await Deno.open(join(release, name), { read: true });
    const size = (await file.stat()).size;
    const headers = {
      "content-type": "text/javascript; charset=utf-8",
      "content-length": String(size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    };
    if (req.method === "HEAD") {
      file.close();
      return new Response(null, { headers });
    }
    return new Response(file.readable, { headers });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
