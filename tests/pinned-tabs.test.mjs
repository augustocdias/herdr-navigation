// Run with `node --test`. Herdr's modules exist only inside the app, so
// they are stubbed: these checks cover how Smart Tabs reconciles pinned tabs.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => {}, svg = () => {}, image = () => {};",
  "gpui-base": "export const h_flex = () => {};",
  herdr: "export const spaces = () => [], panes = () => [], terminals = () => [], run = () => {}, openOverlay = () => {}, theme = () => {}, window = () => {}, shared = () => {}, layout = () => {}, settings = () => {}, machines = () => [], appHome = () => '', readTextFile = async () => null, notify = () => {};",
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier in stubs ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true } : next(specifier, context),
});
const { pinnedPlan, pinnedCommands, parsePinned } = await import("../navigation/mods/tabs-enriched/main.js");

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
