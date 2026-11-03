/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />

import "$std/dotenv/load.ts";

import { start } from "$fresh/server.ts";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";
import { pinBuildRelease } from "./utils/buildRelease.ts";
import { fromFileUrl } from "$std/path/mod.ts";

const outDir = await pinBuildRelease(
  fromFileUrl(new URL(".", import.meta.url)),
);
await start(manifest, { ...config, build: { ...config.build, outDir } });
