/**
 * @file pythonKernel.ts
 * @description The Python interpreter as a service that outlives the notebook
 *              window.
 *
 *              Two things follow from that. The window can be closed and
 *              reopened without losing a single variable - which is what a
 *              pupil expects, having just spent ten minutes building up state.
 *              And the interpreter can boot in the background right after the
 *              page loads, so opening the window costs nothing.
 *
 *              The worker therefore lives here, at module level, not inside a
 *              component. A component that owns a worker kills it on unmount,
 *              and that was exactly the bug.
 */

import { packageBaseUrl, resolvePyodideBase } from "./pyodidePreload.ts";

export type KernelStatus = "off" | "booting" | "ready" | "running";

export interface KernelOutput {
  type: "stdout" | "stderr" | "result" | "error" | "image";
  text?: string;
  data?: string;
}

export interface KernelEvents {
  /** Status or progress changed; `detail` is a raw hint like "packages:numpy". */
  status?: (status: KernelStatus, detail: string) => void;
  output?: (cellId: string, output: KernelOutput) => void;
  input?: (cellId: string, inputId: number, prompt: string) => void;
  inputCancel?: (inputId: number) => void;
  done?: (cellId: string) => void;
}

class PythonKernel {
  #worker: Worker | null = null;
  #status: KernelStatus = "off";
  #detail = "";
  #version = "";
  #canInterrupt = false;
  #listeners = new Set<KernelEvents>();
  /** Resolves when the interpreter is ready; shared by every caller. */
  #booting: Promise<Worker> | null = null;
  /** The cell currently executing, so late messages can be attributed. */
  #pending: { cellId: string; resolve: () => void } | null = null;

  get status(): KernelStatus {
    return this.#status;
  }
  get detail(): string {
    return this.#detail;
  }
  get version(): string {
    return this.#version;
  }
  get canInterrupt(): boolean {
    return this.#canInterrupt;
  }
  /** True once Python has run at least once, i.e. there is state worth keeping. */
  get isLive(): boolean {
    return this.#worker !== null && this.#status !== "off";
  }

  subscribe(events: KernelEvents): () => void {
    this.#listeners.add(events);
    return () => this.#listeners.delete(events);
  }

  #emitStatus(status: KernelStatus, detail = "") {
    this.#status = status;
    this.#detail = detail;
    for (const l of this.#listeners) l.status?.(status, detail);
  }

  /**
   * Boots the interpreter. Safe to call as often as you like - concurrent
   * calls share the same boot, and a running interpreter is returned as is.
   */
  start(): Promise<Worker> {
    if (this.#worker && this.#status !== "off") {
      return Promise.resolve(this.#worker);
    }
    if (this.#booting) return this.#booting;

    this.#booting = (async () => {
      this.#emitStatus("booting", "loading");
      const indexURL = await resolvePyodideBase();
      const worker = new Worker("/pyodide-worker.js");
      this.#worker = worker;

      return await new Promise<Worker>((resolve, reject) => {
        worker.onmessage = (event) => this.#handle(event.data, resolve, reject);
        worker.onerror = (event) => {
          this.#emitStatus("off", event.message ?? "worker failed");
          this.#worker = null;
          this.#booting = null;
          reject(new Error(event.message ?? "worker failed"));
        };
        worker.postMessage({
          type: "init",
          indexURL,
          packageBaseUrl: packageBaseUrl(),
        });
      });
    })();

    // A failed boot must not poison the next attempt.
    this.#booting.catch(() => {
      this.#booting = null;
    });
    return this.#booting;
  }

  // deno-lint-ignore no-explicit-any
  #handle(msg: any, resolve: (w: Worker) => void, reject: (e: Error) => void) {
    switch (msg.type) {
      case "status":
        // Boot progress and package downloads both arrive here; keep the
        // coarse state and pass the detail on for the label.
        this.#emitStatus(
          this.#status === "booting" ? "booting" : this.#status,
          msg.text,
        );
        break;

      case "ready":
        this.#version = msg.version ?? "";
        this.#canInterrupt = !!msg.canInterrupt;
        this.#emitStatus("ready");
        if (this.#worker) resolve(this.#worker);
        break;

      case "stdout":
      case "stderr":
      case "result":
      case "error":
        this.#fanOutput(msg.id, { type: msg.type, text: msg.text });
        break;

      case "image":
        this.#fanOutput(msg.id, { type: "image", data: msg.data });
        break;

      case "input":
        for (const l of this.#listeners) {
          l.input?.(msg.id, msg.inputId, msg.prompt);
        }
        break;

      case "input-cancel":
        for (const l of this.#listeners) l.inputCancel?.(msg.inputId);
        break;

      case "done": {
        const pending = this.#pending;
        if (pending && pending.cellId === msg.id) {
          this.#pending = null;
          pending.resolve();
        }
        this.#emitStatus("ready");
        for (const l of this.#listeners) l.done?.(msg.id);
        break;
      }

      case "fatal":
        this.#emitStatus("off", msg.text ?? "");
        this.#worker = null;
        this.#booting = null;
        reject(new Error(msg.text ?? "kernel failed"));
        break;
    }
  }

  #fanOutput(cellId: string, output: KernelOutput) {
    for (const l of this.#listeners) l.output?.(cellId, output);
  }

  /** Runs one cell. Resolves when the interpreter reports it finished. */
  async run(cellId: string, code: string): Promise<void> {
    const worker = await this.start();
    this.#emitStatus("running");
    await new Promise<void>((resolve) => {
      this.#pending = { cellId, resolve };
      worker.postMessage({ type: "run", id: cellId, code });
    });
  }

  answerInput(inputId: number, value: string | null) {
    this.#worker?.postMessage({
      type: "input-response",
      inputId,
      value: value ?? "",
      cancelled: value === null,
    });
  }

  interrupt() {
    this.#worker?.postMessage({ type: "interrupt" });
  }

  /** Throws the interpreter away, taking every variable with it. */
  restart() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#booting = null;
    this.#pending = null;
    this.#canInterrupt = false;
    this.#emitStatus("off");
  }
}

/**
 * One interpreter per page. Exported as an instance on purpose: a module is a
 * singleton, so the notebook window can come and go while Python stays put.
 */
export const pythonKernel = new PythonKernel();

/**
 * Boots Python quietly once the page is idle, so the notebook opens instantly.
 *
 * This replaces merely warming the HTTP cache: downloading the files still
 * left the compile and the interpreter start to be paid when the window
 * opened. Doing the whole boot up front costs a worker sitting in memory - a
 * fair trade for a feature people click on expecting it to just be there.
 */
export function schedulePythonBoot(delayMs = 3000) {
  // deno-lint-ignore no-explicit-any
  const connection = (navigator as any)?.connection;
  if (connection?.saveData) return;
  if (/(^|-)(2g|slow-2g)$/.test(String(connection?.effectiveType ?? ""))) {
    return;
  }

  const begin = () => {
    pythonKernel.start().catch(() => {
      // Nothing to do - the window will try again and show the error there.
    });
  };
  // deno-lint-ignore no-explicit-any
  const idle = (globalThis as any).requestIdleCallback;
  if (typeof idle === "function") idle(begin, { timeout: delayMs * 2 });
  else setTimeout(begin, delayMs);
}
