// Run with `node --test`. Herdr's modules exist only inside the app, so
// they are stubbed: these checks cover how Smart Tabs reconciles pinned tabs.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => {}, svg = () => {}, image = () => {};",
  "gpui-base": "export const h_flex = () => {}, v_flex = () => {};",
  herdr: "export const spaces = () => [], panes = () => [], terminals = () => [], run = () => {}, openOverlay = () => {}, closeOverlay = () => {}, props = () => null, keys = () => [], theme = () => {}, window = () => {}, shared = () => {}, setShared = () => {}, layout = () => {}, settings = () => {}, machines = () => [], appHome = () => '', readTextFile = async () => null, exec = async () => ({ code: 1 }), notify = () => {};",
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier in stubs ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true } : next(specifier, context),
});
const { pinnedPlan, pinnedCommands, parsePinned, readPins, effectivePins, setPin, prunePins, loadPinned, iconLookup, tabMenu, tabFace } = await import("../navigation/mods/tabs-enriched/main.js");

const board = { label: "Board", mod: "board" };
const notes = { label: "Notes", mod: "notes" };
const tab = (id, index, name) => ({ id, index, name, named: true });

test("a space without the pinned tab gets it", () => {
  const space = { tabs: [tab("t1", 1, "1")] };
  const plan = pinnedPlan([board], space, [{ tab: "t1", terminal: "t1" }]);
  assert.deepEqual(plan.missing, [board]);
  assert.deepEqual(plan.moves, []);
});

test("a pinned tab already present is not opened again", () => {
  const space = { tabs: [tab("p", 1, "Board"), tab("t1", 2, "1")] };
  const plan = pinnedPlan([board], space, [{ tab: "p", mod: "board" }, { tab: "t1", terminal: "t1" }]);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual([...plan.pinned], ["p"]);
});

test("an ordinary tab with the same name is not taken for the pinned one", () => {
  const space = { tabs: [tab("t1", 1, "Board")] };
  assert.deepEqual(pinnedPlan([board], space, [{ tab: "t1", terminal: "t1" }]).missing, [board]);
});

test("pinned tabs are moved to the start in configured order", () => {
  const space = { tabs: [tab("t1", 1, "1"), tab("n", 2, "Notes"), tab("b", 3, "Board")] };
  const plan = pinnedPlan([board, notes], space, [{ tab: "n", mod: "notes" }, { tab: "b", mod: "board" }]);
  assert.deepEqual(plan.moves, [{ id: "b", index: 1 }, { id: "n", index: 2 }]);
});

test("pinned configuration keeps valid, distinct entries", () => {
  const text = JSON.stringify([board, { label: "No mod" }, { mod: "x" }, { ...notes, props: { a: 1 } }, board]);
  assert.deepEqual(parsePinned(text), [board, notes]);
});

test("missing or invalid configuration pins nothing", () => {
  assert.deepEqual(parsePinned(null), []);
  assert.throws(() => parsePinned("{"));
  assert.throws(() => parsePinned("{}"), /list/);
});

test("a pinned tab is opened once, then the person's tab is selected again", () => {
  const opening = new Map();
  const before = { id: "s", tabs: [{ ...tab("t1", 1, "1"), active: true }] };
  const open = [["tab.new", { space: "s", name: "Board", mod: "board" }]];
  assert.deepEqual(pinnedCommands(pinnedPlan([board], before, []), before, opening), open);
  // spaces() has not caught up yet: no second tab.new.
  assert.deepEqual(pinnedCommands(pinnedPlan([board], before, []), before, opening), []);
  const after = { id: "s", tabs: [{ ...tab("p", 1, "Board"), active: true }, tab("t1", 2, "1")] };
  const panes = [{ tab: "p", mod: "board" }];
  assert.deepEqual(pinnedCommands(pinnedPlan([board], after, panes), after, opening), [["tab.select", { id: "t1" }]]);
  assert.deepEqual(pinnedCommands(pinnedPlan([board], after, panes), after, opening), []);
});

test("a closed pinned tab opens again", () => {
  const opening = new Map();
  const present = { id: "s", tabs: [tab("p", 1, "Board"), { ...tab("t1", 2, "1"), active: true }] };
  assert.deepEqual(pinnedCommands(pinnedPlan([board], present, [{ tab: "p", mod: "board" }]), present, opening), []);
  const closed = { id: "s", tabs: [{ ...tab("t1", 1, "1"), active: true }] };
  assert.deepEqual(pinnedCommands(pinnedPlan([board], closed, []), closed, opening), [["tab.new", { space: "s", name: "Board", mod: "board" }]]);
});

test("a pinned tab that cannot open is not retried", () => {
  const opening = new Map();
  const space = { id: "s", tabs: [{ ...tab("t1", 1, "1"), active: true }] };
  assert.equal(pinnedCommands(pinnedPlan([board], space, []), space, opening).length, 1);
  for (let i = 0; i < 3; i++) assert.deepEqual(pinnedCommands(pinnedPlan([board], space, []), space, opening), []);
});

const none = { added: [], removed: [] };

test("runtime pins follow the declared ones; an unpin hides a declared one", () => {
  assert.deepEqual(effectivePins([board], { added: [notes, board], removed: [] }), [board, notes]);
  assert.deepEqual(effectivePins([board, notes], { added: [], removed: [board] }), [notes]);
});

test("unpinning a declared tab is remembered; unpinning a runtime pin forgets it", () => {
  assert.deepEqual(setPin([board], none, board, false), { added: [], removed: [board] });
  assert.deepEqual(setPin([], { added: [notes], removed: [] }, notes, false), none);
});

test("pinning undoes an unpin or adds a runtime pin", () => {
  assert.deepEqual(setPin([board], { added: [], removed: [board] }, board, true), none);
  assert.deepEqual(setPin([board], none, notes, true), { added: [notes], removed: [] });
  assert.deepEqual(setPin([], { added: [notes], removed: [] }, notes, true), { added: [notes], removed: [] });
});

test("an unpin lasts until its entry leaves the configuration", () => {
  const pins = { added: [], removed: [board, notes] };
  assert.deepEqual(prunePins([board], pins), { added: [], removed: [board] });
});

test("stored pins that are not entry lists are ignored", () => {
  assert.deepEqual(readPins(undefined), none);
  assert.deepEqual(readPins({ added: "x", removed: [board, { label: 1 }] }), { added: [], removed: [board] });
});

test("the tab menu offers Unpin and no Close for a pinned tab", () => {
  const items = tabMenu(tab("p", 1, "Board"), { id: "s" }, true, { mod: "board", title: "board" });
  assert.deepEqual(items.map(i => i[0]), ["New tab", "Unpin"]);
  assert.deepEqual(items[1][2], { entry: board, on: false });
});

test("the tab menu offers Pin only for a mod tab, named after its mod when unnamed", () => {
  const space = { id: "s" };
  assert.deepEqual(tabMenu(tab("t1", 1, "1"), space, false, undefined).map(i => i[0]), ["Rename", "New tab", "Close"]);
  const items = tabMenu({ id: "t2", index: 2, name: "2", named: false }, space, false, { mod: "notes", title: "notes" });
  assert.deepEqual(items.map(i => i[0]), ["Rename", "New tab", "Pin", "Close"]);
  assert.deepEqual(items[2][2], { entry: { label: "notes", mod: "notes" }, on: true, rename: { id: "t2", name: "notes" } });
});

test("a missing pinned.json keeps unpins; a read one prunes them", () => {
  const pins = { added: [notes], removed: [board] };
  assert.deepEqual(loadPinned(null, pins), { declared: [], pins });
  assert.deepEqual(loadPinned("[]", pins), { declared: [], pins: { added: [notes], removed: [] } });
  assert.deepEqual(loadPinned(JSON.stringify([board]), pins), { declared: [board], pins });
});

test("an unnamed mod tab without a pane title is pinned under its mod name", () => {
  const items = tabMenu({ id: "t2", index: 2, name: "2", named: false }, { id: "s" }, false, { mod: "notes", title: "" });
  assert.deepEqual(items[2][2], { entry: { label: "notes", mod: "notes" }, on: true, rename: { id: "t2", name: "notes" } });
});

test("a missing provider icon is checked again later; a found one is kept", () => {
  const icons = new Map(), pin = "mods/workspace-chrome/pin.svg";
  assert.deepEqual(iconLookup(icons, "board", 0), { path: pin, full: false, check: true });
  // While the read is pending, renders ask nothing.
  assert.deepEqual(iconLookup(icons, "board", 10), { path: pin, full: false, check: false });
  icons.set("board", { found: false, at: 100 });
  assert.deepEqual(iconLookup(icons, "board", 1000), { path: pin, full: false, check: false });
  assert.deepEqual(iconLookup(icons, "board", 2100), { path: pin, full: false, check: true });
  icons.set("board", { found: "tab", at: 2200 });
  assert.deepEqual(iconLookup(icons, "board", 99999), { path: "mods/board/tab-icon.svg", full: true, check: false });
});

test("a tinted icon is drawn meanwhile, and a full-colour tab icon written later replaces it", () => {
  const icons = new Map([["board", { found: "icon", at: 0 }]]), tinted = { path: "mods/board/icon.svg", full: false };
  assert.deepEqual(iconLookup(icons, "board", 1000), { ...tinted, check: false });
  assert.deepEqual(iconLookup(icons, "board", 2000), { ...tinted, check: true });
  // The pending check keeps the tinted icon, not the pin glyph.
  assert.deepEqual(iconLookup(icons, "board", 2010), { ...tinted, check: false });
  icons.set("board", { found: "tab", at: 2100 });
  assert.deepEqual(iconLookup(icons, "board", 9999), { path: "mods/board/tab-icon.svg", full: true, check: false });
});

const zoomed = { id: "p", name: "Shepherd", named: true, zoomed: true, status: "working" };
const title = { text: "herdr-hermes-shepherd", full: "herdr-hermes-shepherd" };

test("a pinned tab is its provider icon alone, zoomed or not, named only in the tooltip", () => {
  const face = tabFace(zoomed, true, title, null, "shepherd");
  assert.deepEqual(face, { icon: { mod: "shepherd" }, text: null, tooltip: "Shepherd", status: false });
  assert.deepEqual(tabFace({ ...zoomed, zoomed: false }, true, title, null, "shepherd"), face);
});

test("an ordinary mod tab shows its provider icon beside its Smart Tabs title", () => {
  assert.deepEqual(tabFace(zoomed, false, title, null, "shepherd"),
    { icon: { mod: "shepherd" }, text: "herdr-hermes-shepherd Z", tooltip: "herdr-hermes-shepherd", status: true });
});

test("an ordinary tab keeps its program icon, and a plain terminal has none", () => {
  const program = { icon: "claude.svg", tint: true };
  assert.deepEqual(tabFace({ ...zoomed, zoomed: false }, false, title, program, "shepherd").icon, { program });
  assert.deepEqual(tabFace({ ...zoomed, zoomed: false }, false, title, {}, "shepherd").icon, { mod: "shepherd" });
  assert.equal(tabFace({ ...zoomed, zoomed: false }, false, title, {}, undefined).icon, null);
});
