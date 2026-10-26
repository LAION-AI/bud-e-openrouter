/* Browser-only host for the Scratch GUI. No project save endpoint. */
import { compileScript, validatePlan } from "./blocks.js";
(() => {
  "use strict";
  const GUI = globalThis.GUI;
  const parentOrigin = location.origin;
  let channel = "", revision = 0, dirty = false, ready = false, undo = null;
  let authorized = false, loading = true, applying = false;
  let library, libraryError;
  const libraryReady = fetch("/scratch/library.json").then((r) => {
    if (!r.ok) {
      throw new Error("Scratch-Bibliothek konnte nicht geladen werden.");
    }
    return r.json();
  }).then((value) => {
    library = value;
  }).catch((error) => {
    libraryError = error;
  });
  async function requireLibrary() {
    await libraryReady;
    if (libraryError) throw libraryError;
  }
  const storage = new GUI.ScratchStorage();
  const cacheDefault = (translator) =>
    GUI.buildDefaultProject(translator).forEach((asset) => {
      storage.builtinHelper._store(
        storage.AssetType[asset.assetType],
        storage.DataFormat[asset.dataFormat],
        asset.data,
        asset.id,
      );
    });
  cacheDefault();
  storage.addWebStore(
    [
      storage.AssetType.ImageVector,
      storage.AssetType.ImageBitmap,
      storage.AssetType.Sound,
    ],
    (asset) => `/scratch/library-assets/${asset.assetId}.${asset.dataFormat}`,
  );
  const state = new GUI.EditorState({
    locale: new URL(location.href).searchParams.get("lang") === "en"
      ? "en"
      : "de",
  }, () => ({
    storage: {
      scratchStorage: storage,
      setTranslatorFunction: cacheDefault,
      getLibraryAssetUrl: (id, format) =>
        `/scratch/library-assets/${id}.${format}`,
      saveProject: () =>
        Promise.reject(new Error("Server-Speicherung ist deaktiviert.")),
    },
  }));
  const vm = state.store.getState().scratchGui.vm;
  const app = document.getElementById("scratch-app");
  GUI.setAppElement(app);
  const root = GUI.createStandaloneRoot(state, app);
  root.render({
    basePath: "/scratch/vendor/",
    projectId: "0",
    canSave: false,
    canCreateNew: false,
    canCreateCopy: false,
    canRemix: false,
    canShare: false,
    canManageFiles: false,
    canUseCloud: false,
    canEditTitle: true,
    backpackVisible: false,
    showTelemetryModal: false,
    showComingSoon: false,
    enableCommunity: false,
    onClickLogo: () =>
      globalThis.open("/scratch/NOTICE.txt", "_blank", "noopener"),
  });
  const title = () =>
    String(
      state.store.getState().scratchGui.projectTitle || "Mein Scratch-Projekt",
    ).slice(0, 100);
  const send = (data) => {
    if (channel) {
      parent.postMessage(
        { type: "bude-scratch-v1", channel, ...data },
        parentOrigin,
      );
    }
  };
  const meta = () => ({
    ready,
    revision,
    dirty,
    title: title(),
    undo: !!undo,
    working: applying,
  });
  const changed = () => {
    revision++;
    if (!loading) dirty = true;
    send({ meta: meta() });
  };
  vm.on("PROJECT_CHANGED", changed);
  vm.on("PROJECT_LOADED", () => {
    ready = true;
    loading = false;
    send({ meta: meta() });
  });
  let previousTitle = title();
  const checkReady = () => {
    if (
      !ready &&
      state.store.getState().scratchGui.projectState.loadingState.startsWith(
        "SHOWING",
      ) && vm.runtime.targets.length
    ) {
      ready = true;
      loading = false;
      send({ meta: meta() });
    }
  };
  state.store.subscribe(() => {
    checkReady();
    const next = title();
    if (next !== previousTitle) {
      previousTitle = next;
      changed();
    }
  });
  checkReady();
  function requireReady() {
    if (!ready || loading || applying) {
      throw new Error("Scratch lädt noch. Bitte kurz warten.");
    }
  }
  function requirePermission() {
    requireReady();
    if (!authorized) {
      throw new Error("Scratch ist nicht zum Lesen freigegeben.");
    }
  }
  function snapshot() {
    requirePermission();
    const selected = vm.editingTarget ||
      vm.runtime.targets.find((t) => t.isOriginal && !t.isStage);
    const stage = vm.runtime.targets.find((t) => t.isStage);
    const readBlocks = (target) =>
      Object.values(target.blocks._blocks).slice(0, 250).map((
        b,
      ) => ({
        id: b.id,
        opcode: b.opcode,
        next: b.next,
        parent: b.parent,
        inputs: b.inputs,
        fields: b.fields,
        topLevel: b.topLevel,
      }));
    const result = {
      revision,
      title: title(),
      selectedTarget: {
        id: selected.id,
        name: selected.getName(),
        isStage: selected.isStage,
        x: selected.x,
        y: selected.y,
        direction: selected.direction,
        size: selected.size,
        visible: selected.visible,
        blocks: readBlocks(selected),
        variables: selected.variables,
        comments: Object.values(selected.comments || {}).map((c) => ({
          blockId: c.blockId,
          text: c.text,
        })).slice(0, 20),
      },
      stageVariables: stage?.variables,
      targets: vm.runtime.targets.filter((t) => t.isOriginal).map((t) => ({
        id: t.id,
        name: t.getName(),
        isStage: t.isStage,
        blocks: Object.keys(t.blocks._blocks).length,
        ...(t.id !== selected.id
          ? { code: readBlocks(t), variables: t.variables }
          : {}),
        costumes: t.getCostumes().map((c) => c.name),
        sounds: t.getSounds().map((s) => s.name),
      })),
      library: {
        sprites: library.sprites.map((s) => s.name),
        backdrops: library.backdrops.map((s) => s.name),
        featured: library.sprites.filter((s) =>
          [
            "Rocketship",
            "Star",
            "Ball",
            "Cat",
            "Bat",
            "Gobo",
            "Dinosaur4",
            "Robot",
            "Alien",
            "UFO",
            "Beetle",
          ].includes(s.name)
        ).map((s) => ({
          name: s.name,
          tags: s.tags,
          costumes: s.costumes.map((c) => c.name),
          sounds: s.sounds.map((c) => c.name),
        })),
      },
      scope:
        "Aktuelles Projekt: ausgewählte Figur in selectedTarget.blocks, andere Figuren in targets[].code; bis 250 Blöcke je Figur. Lokale Standard-Assets stehen in library. Keine Bild-/Sounddaten und keine Server-Speicherung.",
      truncated: vm.runtime.targets.some((t) =>
        t.isOriginal && Object.keys(t.blocks._blocks).length > 250
      ),
    };
    // Keep a valid object, not a chopped JSON string. Oversized projects require a narrower question.
    if (JSON.stringify(result).length > 90_000) {
      throw new Error(
        "Diese Figur hat sehr viel Code. Wähle eine kleinere Figur für deine Scratch-Frage.",
      );
    }
    return result;
  }
  const numericFields = new Set(["NUM", "ANGLE"]);
  const editableFields = new Set(["NUM", "ANGLE", "TEXT"]);
  function resolveChanges(proposal) {
    requirePermission();
    proposal = validatePlan(proposal);
    if (
      !proposal || proposal.action !== "propose" ||
      proposal.revision !== revision ||
      typeof proposal.summary !== "string" || proposal.summary.length > 1500 ||
      JSON.stringify(proposal).length > 100_000
    ) {
      throw new Error(
        "Das Projekt wurde inzwischen geändert. Frage SchoolBuddy erneut, damit nichts überschrieben wird.",
      );
    }
    const changes = proposal.changes || [], scripts = proposal.scripts || [];
    const aliases = new Map(
      vm.runtime.targets.filter((t) => t.isOriginal).map((t) => [t.id, t]),
    );
    aliases.set("@stage", vm.runtime.getTargetForStage());
    const existingNames = new Set(
      vm.runtime.targets.filter((t) => t.isOriginal && !t.isStage).map((t) =>
        t.getName()
      ),
    );
    for (const s of proposal.sprites) {
      if (
        aliases.has(s.id) || existingNames.has(s.name) ||
        !library.sprites.some((asset) => asset.name === s.asset)
      ) {
        throw new Error(
          "Die neue Figur benötigt einen freien Namen und eine vorhandene lokale Bibliotheksfigur.",
        );
      }
      aliases.set(s.id, { isOriginal: true, isStage: false, isNew: true });
      existingNames.add(s.name);
    }
    if (
      proposal.backdrop &&
      !library.backdrops.some((s) => s.name === proposal.backdrop)
    ) {
      throw new Error(
        "Dieses Bühnenbild steht nicht in der lokalen Bibliothek.",
      );
    }
    for (const t of proposal.targets) {
      if (!aliases.has(t.targetId) || aliases.get(t.targetId).isStage) {
        throw new Error("Diese Figur-Einstellung hat kein gültiges Ziel.");
      }
    }
    const resolved = changes.map((change) => {
      if (
        typeof change.value !== "string" || change.value.length > 500 ||
        (!!change.input === !!change.field)
      ) throw new Error("Ungültige Block-Eingabe.");
      const target = vm.runtime.getTargetById(change.targetId);
      let block = target?.blocks.getBlock(change.blockId), field = change.field;
      if (!target?.isOriginal || !block) {
        throw new Error("Die Figur oder der Block existiert nicht mehr.");
      }
      if (change.input) {
        const input = block.inputs[change.input];
        if (!input || !input.shadow || input.block !== input.shadow) {
          throw new Error(
            "Nur direkte Zahlen oder Texte können geändert werden, keine verschachtelten Blöcke.",
          );
        }
        block = target.blocks.getBlock(input.shadow);
        field = Object.keys(block?.fields || {}).find((key) =>
          editableFields.has(key)
        );
      }
      if (
        !block || !editableFields.has(field) || !block.fields[field] ||
        block.fields[field].id
      ) {
        throw new Error(
          "Nur Zahlen und Texte sind als direkte KI-Änderung erlaubt.",
        );
      }
      if (
        numericFields.has(field) &&
        (!change.value.trim() || !Number.isFinite(Number(change.value)) ||
          Math.abs(Number(change.value)) > 1e6)
      ) throw new Error("Bitte eine gültige, überschaubare Zahl verwenden.");
      return { target, block, field, value: change.value };
    });
    const replacements = [];
    const replaced = new Set();
    const collectTree = (target, blockId, ids = new Set()) => {
      if (ids.has(blockId)) {
        throw new Error(
          "Die alte Blockfolge enthält eine ungültige Verbindung.",
        );
      }
      ids.add(blockId);
      if (ids.size > 200) {
        throw new Error(
          "Diese bestehende Blockfolge ist zum sicheren Ersetzen zu groß.",
        );
      }
      const b = target.blocks.getBlock(blockId);
      if (!b) throw new Error("Ein vorhandener Block fehlt.");
      if (b.next) collectTree(target, b.next, ids);
      for (const input of Object.values(b.inputs)) {
        if (input.block) collectTree(target, input.block, ids);
        if (input.shadow && input.shadow !== input.block) {
          collectTree(target, input.shadow, ids);
        }
      }
      return ids;
    };
    for (const script of scripts) {
      const target = aliases.get(script.targetId);
      if (
        !target?.isOriginal
      ) {
        throw new Error(
          "Wähle für neue Blockfolgen eine vorhandene Figur oder Bühne.",
        );
      }
      if (script.replace !== undefined) {
        const root = target.blocks?.getBlock(script.replace);
        const identity = `${target.id}:${script.replace}`;
        if (
          typeof script.replace !== "string" || !root || !root.topLevel ||
          root.parent || replaced.has(identity)
        ) {
          throw new Error(
            "Zum Ersetzen muss eine einzelne vorhandene oberste Block-ID angegeben werden.",
          );
        }
        replaced.add(identity);
        const ids = collectTree(target, script.replace);
        if (resolved.some((c) => c.target === target && ids.has(c.block.id))) {
          throw new Error(
            "Bitte die gleiche Blockfolge nicht gleichzeitig ersetzen und einzeln ändern.",
          );
        }
        replacements.push({ target, root, ids });
      }
    }
    return { resolved, scripts, replacements, proposal, aliases };
  }
  const setProperties = (target, props) => {
    if (props.x !== undefined || props.y !== undefined) {
      target.setXY(props.x ?? target.x, props.y ?? target.y);
    }
    if (props.size !== undefined) target.setSize(props.size);
    if (props.direction !== undefined) target.setDirection(props.direction);
    if (props.visible !== undefined) target.setVisible(props.visible);
  };
  function variable(name, kind, target) {
    const type = kind === "broadcast" ? "broadcast_msg" : "";
    const stage = vm.runtime.getTargetForStage();
    const found = [
      ...Object.values(target.variables),
      ...Object.values(stage.variables),
    ].find((v) => v.name === name && v.type === type);
    if (found) return found.id;
    const id = `bude_${crypto.randomUUID()}`;
    stage.createVariable(id, name, type, false);
    return id;
  }
  const helpers = {
    variable,
    menu(opcode, value, target) {
      let valid = false;
      if (opcode === "sensing_keyoptions") {
        valid =
          /^(?:space|up arrow|down arrow|left arrow|right arrow|any|[a-z0-9])$/
            .test(value);
      }
      if (
        ["sensing_touchingobjectmenu", "control_create_clone_of_menu"].includes(
          opcode,
        )
      ) {
        valid = vm.runtime.targets.some((t) =>
          t.isOriginal && !t.isStage && t.getName() === value
        ) || (opcode === "sensing_touchingobjectmenu"
          ? ["_mouse_", "_edge_"]
          : ["_myself_"]).includes(value);
      }
      if (opcode === "looks_costume") {
        valid = target.getCostumes().some((c) => c.name === value);
      }
      if (opcode === "looks_backdrops") {
        valid = vm.runtime.getTargetForStage().getCostumes().some((c) =>
          c.name === value
        );
      }
      if (opcode === "sound_sounds_menu") {
        valid = target.getSounds().some((c) => c.name === value);
      }
      if (opcode === "event_broadcast_menu") valid = value.length > 0;
      if (!valid) throw new Error(`Scratch-Auswahl nicht vorhanden: ${value}`);
    },
  };
  async function applyPlan(plan) {
    for (const s of plan.proposal.sprites) {
      if (!authorized) throw new Error("Scratch-Freigabe wurde aufgehoben.");
      const asset = library.sprites.find((entry) => entry.name === s.asset);
      const ids = new Set(vm.runtime.targets.map((t) => t.id));
      await vm.addSprite(
        JSON.stringify({
          ...structuredClone(asset),
          name: s.name,
          variables: {},
          blocks: {},
        }),
      );
      const target = vm.runtime.targets.find((t) =>
        t.isOriginal && !ids.has(t.id) && t.getName() === s.name
      );
      if (!target) throw new Error("Figur konnte nicht geladen werden.");
      plan.aliases.set(s.id, target);
      setProperties(target, s);
    }
    if (plan.proposal.backdrop) {
      const asset = library.backdrops.find((entry) =>
        entry.name === plan.proposal.backdrop
      );
      await vm.addBackdrop(asset.md5ext, structuredClone(asset));
    }
    for (const v of plan.proposal.variables) {
      const stage = vm.runtime.getTargetForStage();
      stage.variables[variable(v.name, "variable", stage)].value = v.value;
    }
    for (const t of plan.proposal.targets) {
      setProperties(plan.aliases.get(t.targetId), t);
    }
    for (const c of plan.resolved) {
      c.target.blocks.changeBlock({
        id: c.block.id,
        element: "field",
        name: c.field,
        value: c.value,
      });
    }
    for (const r of plan.replacements) {
      for (const comment of Object.values(r.target.comments || {})) {
        if (r.ids.has(comment.blockId)) comment.blockId = null;
      }
      r.target.blocks.deleteBlock(r.root.id);
    }
    let offset = 0;
    for (const s of plan.scripts) {
      const target = plan.aliases.get(s.targetId);
      const replacement = plan.replacements.find((r) =>
        r.target === target && r.root.id === s.replace
      );
      compileScript(
        target,
        s.blocks,
        helpers,
        offset++,
        null,
        replacement?.root,
      );
    }
    for (const s of plan.proposal.sprites) {
      for (const script of s.scripts) {
        compileScript(plan.aliases.get(s.id), script, helpers, offset++);
      }
    }
    if (!authorized) throw new Error("Scratch-Freigabe wurde aufgehoben.");
    if (plan.proposal.title) {
      state.dispatch({
        type: "projectTitle/SET_PROJECT_TITLE",
        title: plan.proposal.title,
      });
    }
    if (plan.proposal.sprites.length) {
      vm.setEditingTarget(plan.aliases.get(plan.proposal.sprites[0].id).id);
    }
    vm.emitWorkspaceUpdate();
    vm.emitTargetsUpdate();
    vm.runtime.emitProjectChanged();
  }
  async function importProject(data) {
    requireReady();
    if (
      !(data.bytes instanceof ArrayBuffer) ||
      data.bytes.byteLength > 30_000_000 || !/\.sb3$/i.test(data.name)
    ) throw new Error("Bitte eine .sb3-Datei bis 30 MB wählen.");
    const backup = await vm.saveProjectSb3();
    loading = true;
    try {
      vm.stopAll();
      await vm.loadProject(data.bytes);
      state.dispatch({
        type: "projectTitle/SET_PROJECT_TITLE",
        title: data.name.replace(/\.sb3$/i, "").slice(0, 100),
      });
      undo = null;
      dirty = false;
      revision++;
    } catch {
      await vm.loadProject(await backup.arrayBuffer());
      throw new Error(
        "Die Datei konnte nicht geöffnet werden. Dein bisheriges Projekt bleibt erhalten.",
      );
    } finally {
      loading = false;
      send({ meta: meta() });
    }
  }
  globalThis.addEventListener("message", async (event) => {
    const d = event.data;
    if (
      event.origin !== parentOrigin || event.source !== parent ||
      d?.type !== "bude-scratch-v1"
    ) return;
    if (d.operation === "init" && typeof d.channel === "string") {
      channel = d.channel;
      send({ meta: meta() });
      return;
    }
    if (!channel || d.channel !== channel) return;
    let ownsLock = false;
    try {
      let result;
      switch (d.operation) {
        case "permission":
          authorized = d.data === true;
          break;
        case "snapshot":
          await requireLibrary();
          result = snapshot();
          break;
        case "validate":
          await requireLibrary();
          resolveChanges(d.data);
          break;
        case "apply": {
          await requireLibrary();
          const plan = resolveChanges(d.data);
          applying = true;
          ownsLock = true;
          app.style.pointerEvents = "none";
          send({ meta: meta() });
          const oldTitle = title();
          const backup = await vm.saveProjectSb3();
          if (!authorized || d.data.revision !== revision) {
            throw new Error(
              "Freigabe oder Projekt geändert. Bitte neu fragen.",
            );
          }
          try {
            vm.stopAll();
            await applyPlan(plan);
            undo = { blob: backup, title: oldTitle, revision };
          } catch {
            undo = null;
            loading = true;
            try {
              await vm.loadProject(await backup.arrayBuffer());
              state.dispatch({
                type: "projectTitle/SET_PROJECT_TITLE",
                title: oldTitle,
              });
            } finally {
              loading = false;
            }
            throw new Error(
              "Der Vorschlag konnte nicht sicher übernommen werden. Dein Projekt wurde wiederhergestellt.",
            );
          }
          send({ meta: meta() });
          break;
        }
        case "undo":
          requireReady();
          if (!undo || undo.revision !== revision) {
            throw new Error(
              "Seit der KI-Änderung hast du weitergearbeitet. Automatisches Rückgängigmachen würde diese Arbeit überschreiben.",
            );
          }
          loading = true;
          vm.stopAll();
          try {
            await vm.loadProject(await undo.blob.arrayBuffer());
            state.dispatch({
              type: "projectTitle/SET_PROJECT_TITLE",
              title: undo.title,
            });
            undo = null;
            dirty = true;
            revision++;
          } finally {
            loading = false;
          }
          send({ meta: meta() });
          break;
        case "import":
          await importProject(d.data);
          break;
        case "export": {
          requireReady();
          const savedRevision = revision;
          const blob = await vm.saveProjectSb3(),
            url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = title().replace(/[\\/:*?"<>|]/g, "_") + ".sb3";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
          if (revision === savedRevision) dirty = false;
          send({ meta: meta() });
          break;
        }
        case "new":
          requireReady();
          vm.stopAll();
          loading = true;
          try {
            cacheDefault();
            await vm.loadProject(GUI.buildDefaultProject()[0].data);
            undo = null;
            dirty = false;
            revision++;
            state.dispatch({
              type: "projectTitle/SET_PROJECT_TITLE",
              title: "Mein Scratch-Projekt",
            });
          } finally {
            loading = false;
          }
          send({ meta: meta() });
          break;
        case "pause":
          requireReady();
          vm.stopAll();
          vm.quit();
          break;
        case "resume":
          requireReady();
          vm.start();
          globalThis.dispatchEvent(new Event("resize"));
          break;
        default:
          throw new Error("Unbekannte Scratch-Aktion.");
      }
      send({ id: d.id, result: result ?? true, meta: meta() });
    } catch (error) {
      send({
        id: d.id,
        error: String(error.message || "Scratch-Aktion fehlgeschlagen."),
        meta: meta(),
      });
    } finally {
      if (ownsLock) {
        applying = false;
        app.style.pointerEvents = "";
        send({ meta: meta() });
      }
    }
  });
  globalThis.addEventListener("keydown", (event) => {
    if (applying) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (event.key === "Escape") send({ close: true });
  }, true);
  globalThis.addEventListener("error", () => {
    if (!ready) {
      send({
        meta: {
          ...meta(),
          error:
            "Scratch konnte nicht starten. Bitte neu laden oder einen aktuellen Browser verwenden.",
        },
      });
    }
  });
})();
