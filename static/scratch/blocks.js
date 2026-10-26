/** Shared, bounded Scratch block DSL. No model JavaScript or external asset URLs. */
const spec = (inputs = {}, fields = {}, extra = {}) => ({
  inputs,
  fields,
  ...extra,
});
const number = "number", text = "text", boolean = "boolean";
const menu = (opcode, field) => ({ opcode, field });
export const BLOCK_SPECS = {
  event_whenflagclicked: spec({}, {}, { hat: true }),
  event_whenkeypressed: spec({}, { KEY_OPTION: "key" }, { hat: true }),
  event_whenthisspriteclicked: spec({}, {}, { hat: true }),
  event_whenbroadcastreceived: spec({}, { BROADCAST_OPTION: "broadcast" }, {
    hat: true,
  }),
  event_broadcast: spec({
    BROADCAST_INPUT: menu("event_broadcast_menu", "BROADCAST_OPTION"),
  }),
  event_broadcastandwait: spec({
    BROADCAST_INPUT: menu("event_broadcast_menu", "BROADCAST_OPTION"),
  }),
  motion_movesteps: spec({ STEPS: number }),
  motion_turnright: spec({ DEGREES: number }),
  motion_turnleft: spec({ DEGREES: number }),
  motion_gotoxy: spec({ X: number, Y: number }),
  motion_glidesecstoxy: spec({ SECS: number, X: number, Y: number }),
  motion_changexby: spec({ DX: number }),
  motion_changeyby: spec({ DY: number }),
  motion_setx: spec({ X: number }),
  motion_sety: spec({ Y: number }),
  motion_pointindirection: spec({ DIRECTION: number }),
  motion_ifonedgebounce: spec(),
  motion_setrotationstyle: spec({}, {
    STYLE: ["all around", "left-right", "don't rotate"],
  }),
  motion_xposition: spec({}, {}, { reporter: number }),
  motion_yposition: spec({}, {}, { reporter: number }),
  motion_direction: spec({}, {}, { reporter: number }),
  looks_say: spec({ MESSAGE: text }),
  looks_sayforsecs: spec({ MESSAGE: text, SECS: number }),
  looks_think: spec({ MESSAGE: text }),
  looks_thinkforsecs: spec({ MESSAGE: text, SECS: number }),
  looks_show: spec(),
  looks_hide: spec(),
  looks_nextcostume: spec(),
  looks_changesizeby: spec({ CHANGE: number }),
  looks_setsizeto: spec({ SIZE: number }),
  looks_switchcostumeto: spec({ COSTUME: menu("looks_costume", "COSTUME") }),
  looks_switchbackdropto: spec({
    BACKDROP: menu("looks_backdrops", "BACKDROP"),
  }),
  looks_changeeffectby: spec({ CHANGE: number }, {
    EFFECT: [
      "COLOR",
      "FISHEYE",
      "WHIRL",
      "PIXELATE",
      "MOSAIC",
      "BRIGHTNESS",
      "GHOST",
    ],
  }),
  looks_cleargraphiceffects: spec(),
  control_wait: spec({ DURATION: number }),
  control_repeat: spec({ TIMES: number }, {}, { substacks: 1 }),
  control_forever: spec({}, {}, { substacks: 1, terminal: true }),
  control_if: spec({ CONDITION: boolean }, {}, { substacks: 1 }),
  control_if_else: spec({ CONDITION: boolean }, {}, { substacks: 2 }),
  control_repeat_until: spec({ CONDITION: boolean }, {}, { substacks: 1 }),
  control_wait_until: spec({ CONDITION: boolean }),
  control_stop: spec({}, { STOP_OPTION: ["all", "this script"] }, {
    terminal: true,
  }),
  control_start_as_clone: spec({}, {}, { hat: true }),
  control_create_clone_of: spec({
    CLONE_OPTION: menu("control_create_clone_of_menu", "CLONE_OPTION"),
  }),
  control_delete_this_clone: spec({}, {}, { terminal: true }),
  sensing_keypressed: spec(
    { KEY_OPTION: menu("sensing_keyoptions", "KEY_OPTION") },
    {},
    { reporter: boolean },
  ),
  sensing_touchingobject: spec(
    {
      TOUCHINGOBJECTMENU: menu(
        "sensing_touchingobjectmenu",
        "TOUCHINGOBJECTMENU",
      ),
    },
    {},
    { reporter: boolean },
  ),
  sensing_touchingcolor: spec({ COLOR: "color" }, {}, { reporter: boolean }),
  sensing_mousedown: spec({}, {}, { reporter: boolean }),
  sensing_mousex: spec({}, {}, { reporter: number }),
  sensing_mousey: spec({}, {}, { reporter: number }),
  sensing_timer: spec({}, {}, { reporter: number }),
  sensing_resettimer: spec(),
  data_variable: spec({}, { VARIABLE: "variable" }, { reporter: text }),
  data_setvariableto: spec({ VALUE: text }, { VARIABLE: "variable" }),
  data_changevariableby: spec({ VALUE: number }, { VARIABLE: "variable" }),
  data_showvariable: spec({}, { VARIABLE: "variable" }),
  data_hidevariable: spec({}, { VARIABLE: "variable" }),
  operator_add: spec({ NUM1: number, NUM2: number }, {}, { reporter: number }),
  operator_subtract: spec({ NUM1: number, NUM2: number }, {}, {
    reporter: number,
  }),
  operator_multiply: spec({ NUM1: number, NUM2: number }, {}, {
    reporter: number,
  }),
  operator_divide: spec({ NUM1: number, NUM2: number }, {}, {
    reporter: number,
  }),
  operator_mod: spec({ NUM1: number, NUM2: number }, {}, { reporter: number }),
  operator_random: spec({ FROM: number, TO: number }, {}, { reporter: number }),
  operator_lt: spec({ OPERAND1: text, OPERAND2: text }, {}, {
    reporter: boolean,
  }),
  operator_gt: spec({ OPERAND1: text, OPERAND2: text }, {}, {
    reporter: boolean,
  }),
  operator_equals: spec({ OPERAND1: text, OPERAND2: text }, {}, {
    reporter: boolean,
  }),
  operator_and: spec({ OPERAND1: boolean, OPERAND2: boolean }, {}, {
    reporter: boolean,
  }),
  operator_or: spec({ OPERAND1: boolean, OPERAND2: boolean }, {}, {
    reporter: boolean,
  }),
  operator_not: spec({ OPERAND: boolean }, {}, { reporter: boolean }),
  operator_join: spec({ STRING1: text, STRING2: text }, {}, { reporter: text }),
  operator_round: spec({ NUM: number }, {}, { reporter: number }),
  sound_play: spec({ SOUND_MENU: menu("sound_sounds_menu", "SOUND_MENU") }),
  sound_playuntildone: spec({
    SOUND_MENU: menu("sound_sounds_menu", "SOUND_MENU"),
  }),
  sound_stopallsounds: spec(),
};
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const safeId = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 120 &&
  !["__proto__", "constructor", "prototype"].includes(v);
const literal = (v) =>
  (typeof v === "string" && v.length <= 500) ||
  (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6);
const name = (v) =>
  // deno-lint-ignore no-control-regex
  safeId(v) && v.length <= 60 && !/[\r\n\x00-\x1f]/.test(v) &&
  !/^_[^ ]+_$/.test(v);
const check = (valid, reason) => {
  if (!valid) throw new Error(reason);
};
export function validatePlan(raw) {
  check(
    plain(raw) && raw.action === "propose" &&
      Number.isSafeInteger(raw.revision) && raw.revision >= 0 &&
      typeof raw.summary === "string" && !!raw.summary.trim() &&
      raw.summary.length <= 1500 &&
      JSON.stringify(raw).length <= 100_000,
    "Ungültiger Scratch-Änderungsvorschlag.",
  );
  const plan = {
    action: "propose",
    revision: raw.revision,
    summary: raw.summary.trim(),
    changes: raw.changes ?? [],
    scripts: raw.scripts ?? [],
    sprites: raw.sprites ?? [],
    variables: raw.variables ?? [],
    targets: raw.targets ?? [],
  };
  for (
    const [key, limit] of [["changes", 30], ["scripts", 24], ["sprites", 12], [
      "variables",
      30,
    ], ["targets", 12]]
  ) {
    check(
      Array.isArray(plan[key]) && plan[key].length <= limit,
      `Scratch: Zu viele oder ungültige ${key}.`,
    );
  }
  if (raw.backdrop !== undefined) {
    check(name(raw.backdrop), "Ungültiger Bühnenbildname.");
    plan.backdrop = raw.backdrop;
  }
  if (raw.title !== undefined) {
    check(name(raw.title), "Ungültiger Projektname.");
    plan.title = raw.title;
  }
  check(
    plan.changes.length + plan.scripts.length + plan.sprites.length +
        plan.variables.length + plan.targets.length + !!plan.backdrop > 0,
    "Der Vorschlag enthält keine Änderung.",
  );
  for (const c of plan.changes) {
    check(
      plain(c) && safeId(c.targetId) && safeId(c.blockId) &&
        typeof c.value === "string" && literal(c.value) &&
        (!!c.input !== !!c.field) && safeId(c.input ?? c.field),
      "Scratch: Ungültige Block-Änderung.",
    );
  }
  let count = 0;
  function block(b, depth, reporter = false, index = 0, last = false) {
    check(
      depth <= 12 && ++count <= 600,
      "Scratch: Zu viele oder zu tief verschachtelte Blöcke.",
    );
    check(
      plain(b) && typeof b.opcode === "string" &&
        Object.hasOwn(BLOCK_SPECS, b.opcode),
      "Dieser Scratch-Block wird noch nicht unterstützt.",
    );
    const s = BLOCK_SPECS[b.opcode],
      inputs = b.inputs ?? {},
      fields = b.fields ?? {};
    check(
      !!s.reporter === reporter && (!s.hat || (depth === 0 && index === 0)) &&
        (!s.terminal || last),
      "Scratch: Dieser Block steht an einer ungültigen Stelle.",
    );
    check(
      plain(inputs) &&
        Object.keys(inputs).length === Object.keys(s.inputs).length &&
        plain(fields) &&
        Object.keys(fields).length === Object.keys(s.fields).length,
      "Scratch: Eingaben oder Auswahlfelder passen nicht.",
    );
    for (const [key, type] of Object.entries(s.inputs)) {
      check(Object.hasOwn(inputs, key), `Scratch: Eingabe ${key} fehlt.`);
      const v = inputs[key];
      if (plain(v)) {
        block(v, depth + 1, true);
        check(
          type !== boolean || BLOCK_SPECS[v.opcode].reporter === boolean,
          "Scratch: Eine Bedingung benötigt einen Wahr/Falsch-Block.",
        );
        check(
          typeof type !== "object" && type !== "color",
          "Scratch: Dieses Auswahlfeld benötigt einen Namen.",
        );
      } else {
        check(
          literal(v) && type !== boolean,
          "Scratch: Ungültige Eingabe oder Bedingung.",
        );
        if (type === number) {
          check(
            String(v).trim() && Number.isFinite(Number(v)) &&
              Math.abs(Number(v)) <= 1e6,
            "Scratch: Bitte eine gültige Zahl verwenden.",
          );
        }
        if (type === "color") {
          check(
            /^#[a-f0-9]{6}$/i.test(String(v)),
            "Scratch: Farbe als #RRGGBB angeben.",
          );
        }
        if (typeof type === "object") {
          check(
            typeof v === "string" && v.length <= 60,
            "Scratch: Ungültiger Auswahlname.",
          );
        }
      }
    }
    for (const [key, type] of Object.entries(s.fields)) {
      const v = fields[key];
      check(
        Object.hasOwn(fields, key) && name(v),
        `Scratch: Auswahlfeld ${key} fehlt oder ist ungültig.`,
      );
      if (Array.isArray(type)) {
        check(type.includes(v), `Scratch: Auswahlwert ${v} ist ungültig.`);
      }
      if (type === "key") {
        check(
          /^(?:space|up arrow|down arrow|left arrow|right arrow|any|[a-z0-9])$/
            .test(v),
          "Scratch: Ungültige Taste.",
        );
      }
    }
    for (
      const [key, needed] of [["substack", s.substacks >= 1], [
        "substack2",
        s.substacks >= 2,
      ]]
    ) {
      if (needed) chain(b[key], depth + 1);
      else {check(
          b[key] === undefined,
          "Scratch: Dieser Block enthält keinen inneren Stapel.",
        );}
    }
  }
  function chain(blocks, depth = 0) {
    check(
      Array.isArray(blocks) && blocks.length > 0 && blocks.length <= 80 &&
        depth <= 12,
      "Scratch: Ungültige oder zu tiefe Blockfolge.",
    );
    blocks.forEach((b, i) =>
      block(b, depth, false, i, i === blocks.length - 1)
    );
  }
  for (const s of plan.scripts) {
    check(
      plain(s) && safeId(s.targetId) &&
        (s.replace === undefined || safeId(s.replace)),
      "Scratch: Ungültige Blockfolge.",
    );
    chain(s.blocks);
  }
  const ids = new Set(), names = new Set();
  for (const s of plan.sprites) {
    check(
      plain(s) && safeId(s.id) && name(s.name) && name(s.asset) &&
        !ids.has(s.id) && !names.has(s.name),
      "Scratch: Jede neue Figur benötigt einen eindeutigen Namen und eine Bibliotheksfigur.",
    );
    ids.add(s.id);
    names.add(s.name);
    check(
      Array.isArray(s.scripts) && s.scripts.length > 0 &&
        s.scripts.length <= 12,
      "Scratch: Ungültige Figuren-Skripte.",
    );
    s.scripts.forEach((blocks) => chain(blocks));
    properties(s);
  }
  for (const v of plan.variables) {
    check(
      plain(v) && name(v.name) && literal(v.value),
      "Scratch: Ungültige lokale Variable.",
    );
  }
  for (const t of plan.targets) {
    check(
      plain(t) && safeId(t.targetId),
      "Scratch: Ungültige Figur-Einstellung.",
    );
    properties(t);
  }
  return plan;
}
function properties(s) {
  for (const key of ["x", "y", "size", "direction"]) {
    if (s[key] !== undefined) {
      check(
        typeof s[key] === "number" && Number.isFinite(s[key]) &&
          Math.abs(s[key]) <= (key === "size" ? 500 : 1000) &&
          (key !== "size" || s[key] > 0),
        "Scratch: Ungültige Figur-Einstellung.",
      );
    }
  }
  if (s.visible !== undefined) {
    check(
      typeof s.visible === "boolean",
      "Scratch: Sichtbarkeit muss wahr/falsch sein.",
    );
  }
}

/** Generate real Scratch VM block graphs, including reporter inputs and menus. */
export function compileScript(
  target,
  blocks,
  helpers,
  offset = 0,
  parent = null,
  position = null,
) {
  const freshId = () => `bude_${crypto.randomUUID()}`;
  function expression(b, parentId, id = freshId(), topLevel = false) {
    const s = BLOCK_SPECS[b.opcode], inputs = {}, fields = {};
    for (const [key, type] of Object.entries(s.fields)) {
      const value = b.fields[key];
      fields[key] = {
        name: key,
        value,
        ...(["variable", "broadcast"].includes(type)
          ? { id: helpers.variable(value, type, target) }
          : {}),
      };
    }
    for (const [key, type] of Object.entries(s.inputs)) {
      const value = b.inputs[key];
      if (plain(value)) {
        inputs[key] = { name: key, block: expression(value, id), shadow: null };
      } else {
        const shadowId = freshId();
        const menuType = typeof type === "object";
        const field = menuType
          ? type.field
          : type === number
          ? "NUM"
          : type === "color"
          ? "COLOUR"
          : "TEXT";
        const shadowFields = { [field]: { name: field, value: String(value) } };
        if (menuType) {
          helpers.menu(type.opcode, String(value), target);
          if (type.field === "BROADCAST_OPTION") {
            shadowFields[field].id = helpers.variable(
              String(value),
              "broadcast",
              target,
            );
          }
        }
        target.blocks.createBlock({
          id: shadowId,
          opcode: menuType
            ? type.opcode
            : type === number
            ? "math_number"
            : type === "color"
            ? "colour_picker"
            : "text",
          inputs: {},
          fields: shadowFields,
          parent: id,
          next: null,
          shadow: true,
          topLevel: false,
        });
        inputs[key] = { name: key, block: shadowId, shadow: shadowId };
      }
    }
    if (b.substack) {
      inputs.SUBSTACK = {
        name: "SUBSTACK",
        block: compileScript(target, b.substack, helpers, offset, id),
        shadow: null,
      };
    }
    if (b.substack2) {
      inputs.SUBSTACK2 = {
        name: "SUBSTACK2",
        block: compileScript(target, b.substack2, helpers, offset, id),
        shadow: null,
      };
    }
    target.blocks.createBlock({
      id,
      opcode: b.opcode,
      inputs,
      fields,
      next: null,
      parent: parentId,
      shadow: false,
      topLevel,
      ...(b.opcode === "control_stop"
        ? { mutation: { tagName: "mutation", children: [], hasnext: "false" } }
        : {}),
    });
    return id;
  }
  const ids = blocks.map(() => freshId());
  blocks.forEach((b, i) => {
    expression(b, ids[i - 1] ?? parent, ids[i], i === 0 && parent === null);
    const created = target.blocks.getBlock(ids[i]);
    created.next = ids[i + 1] ?? null;
    created.topLevel = i === 0 && parent === null;
    if (created.topLevel) {
      created.x = position?.x ?? 60 + offset * 100;
      created.y = position?.y ?? 80 + offset * 80;
    }
  });
  target.blocks.resetCache();
  return ids[0];
}
