import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

let focused, closed, calls, inputs, receiveCommand;
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
const agentList = tabs.map((tab) => ({ address: `agent-${tab.status}`, tab: tab.id, status: tab.status, program: { name: "OMP" } }));
globalThis.pickerTest = {
  element, InputState,
  agents: () => agentList,
  spaces: () => [{ id: "space", name: "workspace", status: "blocked", active: true, tabs }],
  run: (name, args) => calls.push([name, args]),
  closeOverlay: () => { closed++; },
  nextCommand: () => new Promise((resolve) => { receiveCommand = resolve; }),
};
const stubs = {
  "gpui-kit": "export class View {} export const div = () => globalThis.pickerTest.element(), svg = div;",
  "gpui-base": `export const h_flex = () => globalThis.pickerTest.element(), v_flex = h_flex;
    export const {InputState} = globalThis.pickerTest;
    export const Input = {new: (state) => globalThis.pickerTest.element("input", state)};`,
  herdr: `export const {agents, spaces, run, closeOverlay, nextCommand} = globalThis.pickerTest;
    export const panes = () => [], terminals = () => [], theme = () => ({}), settings = () => ({zoom: 1}),
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
function open() {
  focused = null; closed = 0; calls = []; inputs = []; receiveCommand = null;
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
