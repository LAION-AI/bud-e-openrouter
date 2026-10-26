# Bud-E OpenRouter

Bud-E is LAION's browser-based AI learning and productivity assistant. This
repository combines the current Fresh/Preact web application with the existing
Flutter application in [`school_bud_e_flutter/`](school_bud_e_flutter/).

The web application includes:

- Streaming text and vision chat, microphone recording, transcription and speech
  playback, document/image uploads, image references, and chat import/export.
- OpenRouter and Requesty integrations, plus Google AI Studio support in
  teacher-managed classrooms. Features depend on the provider, key, model and
  administrator settings.
- Teacher settings at `/my` and one student chat per pseudonym at `/<pseudonym>`,
  with encrypted server-side provider keys, timed activation and usage budgets.
- Shareable learning paths, a Python notebook, document and slide editors, and an
  embedded Scratch editor. On request and with permission, Bud-E can read and
  change the current editor contents.
- Wikipedia and paper searches with expandable source results, Markdown rendering
  and copyable code blocks.

## Run the web application

Use Deno 2 with `node:sqlite` support (tested with Deno 2.4.5). Scratch setup also
uses `tar` and `gzip`. The optional PDF fallback uses Poppler's `pdftoppm` and
`pdftotext` executables.

```sh
git clone https://github.com/LAION-AI/bud-e-openrouter.git
cd bud-e-openrouter
cp .example.env .env

# Download the self-hosted browser runtimes before using the editors.
deno task pyodide
deno task scratch

deno task start
```

Open `http://localhost:8000`. Configure the main chat's provider in Settings or
provide the server-side settings documented in `.example.env` and the API routes.
Never commit `.env` or real provider keys.

For a production build:

```sh
deno task build
PORT=8000 deno task preview
```

Place production behind HTTPS. Teacher registration/login, classroom mutations
and the agreement flow require HTTPS and secure cookies. A localhost preview can
display the interface but does not replace an HTTPS classroom test.

`deno task preview` uses the existing `_fresh/` build. Rebuild and restart after
changing application code. Restart after replacing static runtime files too.
Runtime downloads are excluded from Git; install them in each new checkout or
deployment before using the corresponding editors.

## Classroom storage

Set `CLASSROOM_DATA_DIR` to an absolute, writable directory. The default is
`/var/lib/bude-classrooms`. The server creates its database and encryption key
there. Back up the database and `master.key` together and retain this directory
across deployments. These private files do not belong in Git. Student Scratch
projects stay in the browser tab and are saved locally as `.sb3` downloads.

Details: [classrooms](KLASSENRAEUME.md), [Scratch](SCRATCH.md),
[learning paths](LERNPFADE.md).

## Checks

```sh
deno test -A tests
deno task check-paths
deno task build
```

Automated tests replace provider calls with fixtures. Optional Playwright tests
exercise the real browser editors; see `SCRATCH.md` for commands and the
separate opt-in real-provider mode, which can incur usage costs.

## Flutter application

The Flutter/Android application has separate setup and dependencies. See
[`school_bud_e_flutter/README.md`](school_bud_e_flutter/README.md). Its existing
source and history are retained alongside the web application.

## Licensing

See [LICENSE](LICENSE) and [License.txt](License.txt) for the application license.
Scratch has separate AGPL-3.0 and trademark notices in [`static/scratch/`](static/scratch/).
Its reproducible setup and source archive are documented in `SCRATCH.md`.
