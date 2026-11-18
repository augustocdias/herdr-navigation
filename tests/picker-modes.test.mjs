import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

let focused, closed, calls, inputs, receiveCommand, paneList, workspaceList;
function element(kind = "div", state) {
  const node = { kind, state, children: [], events: {}, id: null };
  const view = new Proxy(node, {
    get(target, key) {
      if (key === "node") return target;
      if (key === "child") return (child) => { target.children.push(child); return view; };
      if (key === "children") return (children) => { target.children.push(...children); return view; };
      if (key === "id") return (id) => { target.id = id; return view; };
      if (key === "when") return (on, apply) => on ? apply(view) : view;
      if (key.startsWith("on_")) return (handler) => { target.events[key] = handler; return view; };
      return () => view;
    },
  });
  return view;
}
class InputState {
  static new() { const input = new InputState(); inputs.push(input); return input; }
  constructor() { this.text = ""; this.events = {}; }
  on(name, handler) { this.events[name] = handler; }
  value() { return this.text; }
  set_value(value) { this.text = value; this.events.change?.({}, cx); }
  focus() { focused = this; }
}
const states = ["blocked", "idle", "working", "done"];
const tabs = states.map((status, i) => ({ id: `tab-${status}`, name: `${status} task`, active: i === 0, status }));
const agentList = tabs.map((tab) => ({ address: `agent-${tab.status}`, pane: `pane-${tab.status}`, tab: tab.id, status: tab.status, program: { name: "OMP" } }));
globalThis.pickerTest = {
  element, InputState,
  agents: () => agentList,
  panes: () => paneList,
  spaces: () => workspaceList,
  run: (name, args) => calls.push([name, args]),
  closeOverlay: () => { closed++; },
  nextCommand: () => new Promise((resolve) => { receiveCommand = resolve; }),
};
const stubs = {
  "gpui-kit": "export class View {} export const div = () => globalThis.pickerTest.element(), svg = div;",
  "gpui-base": `export const h_flex = () => globalThis.pickerTest.element(), v_flex = h_flex;
    export const {InputState} = globalThis.pickerTest;
    export const Input = {new: (state) => globalThis.pickerTest.element("input", state)};`,
  herdr: `export const {agents, spaces, panes, run, closeOverlay, nextCommand} = globalThis.pickerTest;
    export const terminals = () => [], theme = () => ({}), settings = () => ({zoom: 1}),
      props = () => ({overlay: "picker"}), hc = async () => ({code: 0, stdout: "{}"}),
      openOverlay = () => {}, shared = () => null, setShared = () => {};`,
};
registerHooks({resolve: (specifier, context, next) => specifier in stubs
  ? {url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true}
  : next(specifier, context)});
const {default: Picker} = await import("../navigation/mods/picker-enriched/main.js");
const cx = {
  focus_handle: () => { const handle = {focus: () => { focused = handle; }}; return handle; },
  timer: {after: () => {}}, spawn: (work) => { void work(cx); }, notify: () => {}, stop_propagation: () => {},
};
function open(panes = []) {
  focused = null; closed = 0; calls = []; inputs = []; receiveCommand = null; paneList = panes;
  workspaceList = [{ id: "space", name: "workspace", status: "blocked", active: true, tabs }];
  const picker = new Picker();
  picker.init({}, cx);
  return picker;
}
function nodes(view) {
  return view?.node ? [view.node, ...view.node.children.flatMap(nodes)] : [];
}
function key(picker, key, modifiers = {}) {
  const root = picker.render().node;
  if (key === "tab") {
    // Native focus traversal can consume Tab without delivering a raw key event.
    receiveCommand?.(modifiers.shift ? "previous" : "next");
    return Promise.resolve();
  }
  root.events.on_key_down({key, modifiers}, cx);
}
function entries(picker) {
  return nodes(picker.render()).map((node) => node.id).filter((id) => id?.startsWith("pk-tab-"));
}

const splitPanes = [
  {pane: "pane-blocked", tab: "tab-blocked", terminal: "agent-blocked", focused: true, program: {name: "OMP", agent: true}, title: "Fix navigation"},
  {pane: "pane-shell", tab: "tab-blocked", program: {name: "Shell"}},
  {pane: "pane-logs", tab: "tab-idle", mod: "logs"},
];
function paneEntries(picker) {
  return nodes(picker.render()).map((node) => node.id).filter((id) => id?.startsWith("pk-pane-"));
}

test("P toggles nested panes only in filter mode and each picker starts with tabs only", () => {
  const picker = open(splitPanes);
  assert.deepEqual(paneEntries(picker), []);
  key(picker, "P", {shift: true});
  assert.deepEqual(paneEntries(picker), ["pk-pane-pane-blocked", "pk-pane-pane-shell", "pk-pane-pane-logs"]);
  key(picker, "/");
  key(picker, "P", {shift: true});
  assert.deepEqual(paneEntries(picker), ["pk-pane-pane-blocked", "pk-pane-pane-shell", "pk-pane-pane-logs"]);
  key(picker, "escape");
  key(picker, "p");
  assert.deepEqual(paneEntries(picker), []);
  assert.deepEqual(paneEntries(open(splitPanes)), []);
});

test("nested panes participate in navigation and Enter focuses the pane instead of its tab", async () => {
  for (const [keys, pane] of [
    [["j"], "pane-blocked"],
    [["down", "tab"], "pane-shell"],
    [["j", "j", "j", "j"], "pane-logs"],
  ]) {
    const picker = open(splitPanes);
    key(picker, "p");
    for (const name of keys) await key(picker, name);
    key(picker, "enter");
    assert.deepEqual(calls, [["pane.focus", {pane}]]);
  }
});

test("toggling pane rows preserves the selected tab or action and collapses a pane to its tab", () => {
  for (const [keys, expected] of [
    [["j", "p"], ["tab.select", {id: "tab-idle"}]],
    [["p", "j", "j", "p"], ["tab.select", {id: "tab-blocked"}]],
    [["up", "p"], ["space.new", {}]],
  ]) {
    const picker = open(splitPanes);
    for (const name of keys) key(picker, name);
    key(picker, "enter");
    assert.deepEqual(calls, [expected], JSON.stringify(keys));
  }
});

test("picker opens in filter mode and only slash starts text search", () => {
  const picker = open();
  assert.equal(focused, picker.handle);
  key(picker, "x");
  assert.deepEqual(entries(picker), ["pk-tab-blocked", "pk-tab-idle", "pk-tab-working", "pk-tab-done"]);
  assert.ok(!nodes(picker.render()).some((node) => node.kind === "input"));
  key(picker, "/");
  const input = nodes(picker.render()).find((node) => node.kind === "input");
  assert.ok(input);
  assert.equal(focused, input.state);
  input.state.set_value("idle");
  assert.deepEqual(entries(picker), ["pk-tab-idle"]);
});

test("filter letters select agent states and stay out of search text", () => {
  const picker = open();
  for (const [letter, status] of [["b", "blocked"], ["i", "idle"], ["w", "working"], ["d", "done"]]) {
    key(picker, letter);
    assert.deepEqual(entries(picker), [`pk-tab-${status}`]);
  }
  key(picker, "a");
  assert.deepEqual(entries(picker), ["pk-tab-blocked", "pk-tab-idle", "pk-tab-working", "pk-tab-done"]);
  key(picker, "/");
  inputs[0].set_value("blocked");
  key(picker, "b");
  assert.equal(picker.stateFilter, "all");
  assert.deepEqual(entries(picker), ["pk-tab-blocked"]);
});

test("Escape clears search and restores filter mode before closing", () => {
  const picker = open();
  key(picker, "i");
  key(picker, "/");
  inputs[0].set_value("missing");
  assert.deepEqual(entries(picker), []);
  key(picker, "escape");
  assert.equal(closed, 0);
  assert.equal(focused, picker.handle);
  assert.deepEqual(entries(picker), ["pk-tab-idle"]);
  key(picker, "w");
  assert.deepEqual(entries(picker), ["pk-tab-working"]);
  key(picker, "escape");
  assert.equal(closed, 1);
});

test("native Tab commands and arrows select entries in both modes", async () => {
  for (const search of [false, true]) {
    for (const [keys, expected] of [
      [[["down"]], ["tab.select", {id: "tab-idle"}]],
      [[["tab"]], ["tab.select", {id: "tab-idle"}]],
      [[["tab"], ["tab", {shift: true}]], ["tab.select", {id: "tab-blocked"}]],
      [[["up"], ["down"]], ["tab.select", {id: "tab-blocked"}]],
      [[["tab", {shift: true}]], ["space.new", {}]],
    ]) {
      const picker = open();
      picker.render();
      if (search) key(picker, "/");
      for (const [name, modifiers] of keys) await key(picker, name, modifiers);
      if (search) inputs[0].events.submit();
      else key(picker, "enter");
      assert.deepEqual(calls, [expected], JSON.stringify({search, keys}));
    }
  }
});

test("the selected workspace title stays visible after scrolling and returning to its first tab", () => {
  const picker = open();
  picker.listHeight = 90;
  const titleCount = () => nodes(picker.render()).flatMap((node) => node.children).filter((child) => child === "workspace").length;
  const list = nodes(picker.render()).find((node) => node.id === "pk-list");
  list.events.on_scroll_wheel({delta: {y: -100}}, cx);
  assert.equal(titleCount(), 1);
  for (let i = 0; i < 3; i++) {
    key(picker, "up");
    assert.equal(titleCount(), 1);
  }
  key(picker, "enter");
  assert.deepEqual(calls, [["tab.select", {id: "tab-blocked"}]]);
});

test("jk select adjacent entries while hjkl stay out of search navigation", () => {
  for (const [keys, expected] of [
    [["j"], ["tab.select", {id: "tab-idle"}]],
    [["j", "k"], ["tab.select", {id: "tab-blocked"}]],
    [["k"], ["space.new", {}]],
  ]) {
    const picker = open();
    for (const name of keys) key(picker, name);
    key(picker, "enter");
    assert.deepEqual(calls, [expected], JSON.stringify(keys));
  }
  for (const name of "hjkl") {
    const picker = open();
    key(picker, "/");
    inputs[0].set_value("task");
    key(picker, name);
    inputs[0].events.submit();
    assert.deepEqual(calls, [["tab.select", {id: "tab-blocked"}]], name);
  }
});

test("hl jump to the first tab of adjacent listed workspaces, skipping nested panes and actions", () => {
  for (const [keys, id] of [
    [["l"], "tab-working"],
    [["h"], "tab-done"],
    [["j", "l"], "tab-working"],
    [["l", "l"], "tab-done"],
    [["l", "l", "l"], "tab-blocked"],
    [["l", "h"], "tab-blocked"],
    [["p", "j", "j", "l"], "tab-working"],
    [["p", "j", "h"], "tab-done"],
    [["up", "l"], "tab-blocked"],
    [["up", "h"], "tab-done"],
    [["i", "l"], "tab-idle"],
  ]) {
    const picker = open(splitPanes);
    workspaceList = [
      {id: "first", name: "First", status: "blocked", active: true, tabs: tabs.slice(0, 2)},
      {id: "second", name: "Second", status: "working", tabs: tabs.slice(2, 3)},
      {id: "third", name: "Third", status: "done", tabs: tabs.slice(3)},
    ];
    for (const name of keys) key(picker, name);
    key(picker, "enter");
    assert.deepEqual(calls, [["tab.select", {id}]], JSON.stringify(keys));
  }
});

test("hl leave a lone workspace selection or an empty picker unchanged", () => {
  for (const name of ["h", "l"]) {
    const picker = open();
    key(picker, "j");
    key(picker, name);
    key(picker, "enter");
    assert.deepEqual(calls, [["tab.select", {id: "tab-idle"}]], name);

    const empty = open();
    workspaceList = [];
    key(empty, name);
    key(empty, "enter");
    assert.deepEqual(calls, [["tab.new", undefined]], name);
  }
});

test("navigation remains usable with no search matches and Ctrl+D still closes a selected tab", async () => {
  const picker = open();
  key(picker, "/");
  inputs[0].set_value("no matching workspace");
  await key(picker, "tab");
  await key(picker, "tab", {shift: true});
  key(picker, "up");
  inputs[0].events.submit();
  assert.deepEqual(calls, [["space.new", {}]]);

  const other = open();
  key(other, "d", {control: true});
  assert.deepEqual(calls, [["tab.close", {id: "tab-blocked"}]]);
});
