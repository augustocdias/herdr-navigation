import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Render the real view against changing host snapshots, retaining its card state.
let listed = [], all = [], order = [];
function element() {
  const node = { children: [], id: null };
  const view = new Proxy(node, {
    get(target, key) {
      if (key === "child") return (child) => { target.children.push(child); return view; };
      if (key === "children") return (children) => { target.children.push(...children); return view; };
      if (key === "id") return (id) => { target.id = id; return view; };
      if (key === "tooltip" || key === "accessibility_label") return (text) => { target[key] = text; return view; };
      if (key === "when") return (on, apply) => on ? apply(view) : view;
      if (key === "node") return target;
      return () => view;
    },
  });
  return view;
}
globalThis.agentLifecycle = {
  element,
  agents: () => listed,
  terminals: () => all,
  setAgentOrder: (addresses) => { order = addresses; },
};
const stubs = {
  "gpui-kit": "export class View {} export const {element: div} = globalThis.agentLifecycle; export const image = div, svg = div;",
  "gpui-base": "export const {element: h_flex} = globalThis.agentLifecycle; export const v_flex = h_flex;",
  herdr: `export const {agents, terminals, setAgentOrder} = globalThis.agentLifecycle;
    export const panes = () => [], spaces = () => [], focused = () => null,
      run = () => {}, theme = () => ({}), shared = () => null, setShared = () => {},
      openOverlay = () => {}, closeOverlay = () => {}, props = () => null,
      window = () => ({}), layout = () => ({}), nextCommand = () => new Promise(() => {});`,
};
registerHooks({
  resolve: (specifier, context, next) => specifier in stubs
    ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true }
    : next(specifier, context),
});
const { default: Agents } = await import("../navigation/mods/agents-enriched/main.js");
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const cx = {
  focus_handle: () => ({ is_focused: () => false, focus: () => {} }),
  timer: { every: () => {} }, spawn: () => {},
};
function ids(view) {
  if (!view?.node) return [];
  return [view.node.id, ...view.node.children.flatMap(ids)];
}

test("an exited agent disappears when its pane returns to a shell, and can start again", () => {
  listed = [{ address: "t1", status: "idle", pane: "p1", space: "s1", tab: "tab1", program: { key: "omp", name: "OMP" } }];
  all = [{ address: "t1", state: "live", foreground: { name: "omp", argv: ["/bin/omp"] } }];
  const view = new Agents();
  view.init({}, cx);
  view.expanded.add("t1");
  assert.ok(ids(view.render(cx)).includes("ag-t1"));

  // Core still reports the agent as idle after its foreground process has exited.
  all = [{ ...all[0], foreground: { name: "fish", argv: ["/bin/fish"] } }];
  assert.ok(!ids(view.render(cx)).includes("ag-t1"));
  assert.deepEqual(order, []);

  all = [{ ...all[0], foreground: { name: "omp", argv: ["/bin/omp"] } }];
  assert.ok(ids(view.render(cx)).includes("ag-t1"));
  assert.deepEqual(order, ["t1"]);
});

test("shell wrappers and unavailable foreground metadata do not hide running agents", () => {
  const foregrounds = [
    { name: "sh", argv: ["/bin/sh", "-ic", "omp"] },
    { name: "bash", argv: ["/bin/bash", "/work/agent.sh"] },
    null,
  ];
  listed = foregrounds.map((_, i) => ({
    address: `remote/t${i}`, status: "working", pane: `p${i}`, space: "s1", tab: "tab1",
    program: { key: "omp", name: "OMP" },
  }));
  all = foregrounds.map((foreground, i) => ({ address: `remote/t${i}`, state: "live", foreground }));
  const view = new Agents();
  view.init({}, cx);
  const rendered = ids(view.render(cx));
  assert.deepEqual(rendered.filter((id) => id?.startsWith("ag-remote/")), ["ag-remote/t0", "ag-remote/t1", "ag-remote/t2"]);
});

test("login shells and Windows shell paths remove stale cards without hiding another agent", () => {
  listed = [
    { address: "remote/t1", status: "done", pane: "p1", space: "s1", tab: "tab1", program: { key: "omp", name: "OMP" } },
    { address: "t2", status: "working", pane: "p2", space: "s1", tab: "tab1", program: { key: "claude", name: "Claude" } },
  ];
  const view = new Agents();
  view.init({}, cx);
  for (const argv of [["-zsh", "-il"], ["C:\\Windows\\System32\\cmd.exe"], ["/bin/fish", "--interactive", "--login"]]) {
    all = [
      { address: "remote/t1", state: "live", foreground: { argv } },
      { address: "t2", state: "live", foreground: { argv: ["/bin/claude"] } },
    ];
    const rendered = ids(view.render(cx));
    assert.ok(!rendered.includes("ag-remote/t1"));
    assert.ok(rendered.includes("ag-t2"));
    assert.deepEqual(order, ["t2"]);
  }
});

test("blocked requests share one card summary while full parent and child reasons remain accessible", () => {
  const parentReason = "Approve deployment to the production workspace after reviewing all outstanding changes.";
  const childReason = "Confirm the database migration before continuing with the deployment.";
  listed = [{ address: "t1", status: "blocked", pane: "p1", program: { key: "omp", name: "OMP" } }];
  all = [
    { address: "t1", state: "live", report: { state: "blocked", msg: parentReason } },
    { address: "t2", parent: "t1", name: "Database", state: "live", status: "blocked", report: { state: "blocked", msg: childReason } },
    { address: "t3", parent: "t1", name: "Release", state: "live", status: "blocked", report: { state: "blocked", msg: "Select a release tag." } },
  ];
  const view = new Agents();
  view.init({}, cx);
  const nodes = (el) => el?.node ? [el.node, ...el.node.children.flatMap(nodes)] : [];
  const summary = `${parentReason}; Database: ${childReason}; Release: Select a release tag.`;
  const collapsed = nodes(view.render(cx));
  const text = collapsed.flatMap((node) => node.children.filter((child) => typeof child === "string"));
  assert.ok(text.includes(summary));
  assert.ok(!text.includes(parentReason));
  const card = collapsed.find((node) => node.id === "ag-t1");
  assert.ok(card.accessibility_label.includes(summary));
  const tooltip = card.tooltip.replace(/\s+/g, " ");
  assert.ok(tooltip.includes(parentReason));
  assert.ok(tooltip.includes(childReason));
  assert.ok(tooltip.includes("Release: Select a release tag."));

  view.expanded.add("t1");
  const expanded = nodes(view.render(cx));
  const child = expanded.find((node) => node.id === "sub-t1>t2");
  assert.ok(child.accessibility_label.includes(childReason));
  assert.equal(child.tooltip.replace(/\s+/g, " "), childReason);
});
