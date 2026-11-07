// Run with `node --test`. Herdr's modules exist only inside the app, so
// they are stubbed: these checks cover what each agent card shows and in what order.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => {}, svg = () => {}, image = () => {};",
  "gpui-base": "export const h_flex = () => {}, v_flex = () => {};",
  herdr: "export const agents = () => [], terminals = () => [], panes = () => [], focused = () => null, spaces = () => [], run = () => {}, theme = () => {}, shared = () => {}, setShared = () => {}, setAgentOrder = () => {}, openOverlay = () => {}, closeOverlay = () => {}, props = () => null, window = () => {}, layout = () => {}, nextCommand = () => new Promise(() => {});",
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier in stubs ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true } : next(specifier, context),
});
const { activity, parseTodo, attentionReason, cardFacts, arrange, sections, keepPresent, children, keyOrder } = await import("../navigation/mods/agents-enriched/main.js");

const NOW = 1_000_000;
const tokens = { agent: "claude-opus", title: "Fix login", todo: "2/5 Writing tests", sub1: "Explore: find callers", sub2: "", sub3: "", submore: "" };
const label = (extra = {}, terminal = {}) => ({
  state: "live",
  program: { key: "claude" },
  labels: { "nix.activity": JSON.stringify({ version: 1, expires: NOW + 1000, agent: "claude", tokens: { ...tokens, ...extra } }) },
  ...terminal,
});
const agent = (address, status, extra = {}) => ({ address, status, pane: `p-${address}`, space: "s1", space_name: "web", tab: "t1", title: "", program: { name: "Claude Code", key: "claude" }, seq: 1, ...extra });

test("live, unexpired enrichment from the same program is read", () => {
  assert.equal(activity(label(), NOW).title, "Fix login");
});

test("expired, malformed, mismatched or not-live enrichment falls back to nothing", () => {
  assert.equal(activity(label({}, { labels: { "nix.activity": JSON.stringify({ version: 1, expires: NOW - 1, agent: "claude", tokens }) } }), NOW), null);
  assert.equal(activity(label({}, { labels: { "nix.activity": "{not json" } }), NOW), null);
  assert.equal(activity(label({}, { program: { key: "codex" } }), NOW), null);
  assert.equal(activity(label({}, { state: "finished" }), NOW), null);
  assert.equal(activity(label({ title: "x".repeat(81) }), NOW), null);
});

test("a checklist summary splits into counts and the active task", () => {
  assert.deepEqual(parseTodo("2/5 Writing tests"), { done: 2, total: 5, task: "Writing tests" });
  assert.deepEqual(parseTodo("0/3"), { done: 0, total: 3, task: "" });
  assert.equal(parseTodo(""), null);
  assert.equal(parseTodo("Writing tests"), null);
});

test("a blocked agent says why when it reported a reason, else Needs attention", () => {
  assert.equal(attentionReason("blocked", { state: "blocked", msg: "  Allow  rm -rf build? " }), "Allow rm -rf build?");
  assert.equal(attentionReason("blocked", { state: "blocked", kind: "permission" }), "Waiting for permission");
  assert.equal(attentionReason("blocked", { state: "blocked", kind: "question" }), "Has a question");
  assert.equal(attentionReason("blocked", null), "Needs attention");
  // A message left over from an earlier report state is not a reason.
  assert.equal(attentionReason("blocked", { state: "working", msg: "Reading files" }), "Needs attention");
  assert.equal(attentionReason("working", { state: "blocked", msg: "Allow?" }), null);
  assert.equal(attentionReason("done", null), null);
});

test("a card shows enriched details and falls back to native data without them", () => {
  const pane = { cwd: "/home/u/web", branch: "fix-login" };
  const rich = cardFacts(agent("t1", "working"), label(), pane, "1", NOW);
  assert.equal(rich.title, "Fix login");
  assert.equal(rich.task, "Writing tests");
  assert.deepEqual(rich.progress, { done: 2, total: 5 });
  assert.equal(rich.model, "claude-opus");
  assert.equal(rich.branch, "fix-login");
  assert.equal(rich.folder, "/home/u/web");
  assert.equal(rich.workspace, "web");
  assert.deepEqual(rich.reported, ["Explore: find callers"]);
  assert.equal(rich.attention, null);

  const plain = cardFacts(agent("t2", "blocked"), { state: "live", program: { key: "claude" }, report: { state: "blocked", title: "Native title" } }, null, "1", NOW);
  assert.equal(plain.title, "Native title");
  assert.equal(plain.task, null);
  assert.equal(plain.model, null);
  assert.equal(plain.branch, null);
  assert.deepEqual(plain.reported, []);
  assert.equal(plain.attention, "Needs attention");

  // No title anywhere: the tab label, then the program; an automatic tab number says nothing.
  assert.equal(cardFacts(agent("t3", "idle"), null, null, "Review", NOW).title, "Review");
  assert.equal(cardFacts(agent("t3", "idle"), null, null, "2", NOW).title, "Claude Code");
});

test("more reported sub-agents than slots are listed as one more line", () => {
  const facts = cardFacts(agent("t1", "working"), label({ sub2: "Plan", sub3: "Review", submore: "Explore, Explore" }), null, "1", NOW);
  assert.deepEqual(facts.reported, ["Explore: find callers", "Plan", "Review", "More: Explore, Explore"]);
});

test("priority order ignores stored agent pins", () => {
  const list = [agent("a", "idle", { seq: 1 }), agent("b", "blocked", { seq: 2 }), agent("c", "working", { seq: 3 })];
  const rank = { a: 1, b: 4, c: 2 };
  const ordered = arrange(list, (a) => rank[a.address], () => 0, true);
  assert.deepEqual(ordered.map((a) => a.address), ["b", "c", "a"]);
  // arrange takes no pins: the grouped order is agents() order.
  assert.deepEqual(arrange(list, (a) => rank[a.address], () => 0, false).map((a) => a.address), ["a", "b", "c"]);
});

test("priority sections and space groups keep their labels", () => {
  const list = [agent("b", "blocked"), agent("c", "working", { space: "s2", space_name: "api" }), agent("a", "idle", { space: "s2", space_name: "api" })];
  const rank = { a: 1, b: 4, c: 2 };
  assert.deepEqual(sections(list, (a) => rank[a.address], true).map((g) => [g.label, g.members.length]), [["Needs you", 1], ["Working", 1], ["Idle", 1]]);
  assert.deepEqual(sections(list, (a) => rank[a.address], false).map((g) => [g.label, g.members.length]), [["web", 1], ["api", 2]]);
  assert.ok(sections(list, (a) => rank[a.address], true).every((g) => g.id !== "pinned"));
});

test("expanded cards stay open while their agent is present", () => {
  const open = new Set(["a", "gone"]);
  assert.deepEqual([...keepPresent(open, ["a", "b"])], ["a"]);
  // Nothing listed yet (just started): nothing is dropped.
  assert.deepEqual([...keepPresent(open, [])], ["a", "gone"]);
  // A machine whose agents are not listed (reconnecting) keeps its expanded cards.
  assert.deepEqual([...keepPresent(new Set(["t1", "vps/t7"]), ["t1"])], ["t1", "vps/t7"]);
  assert.deepEqual([...keepPresent(new Set(["t1", "vps/t7"]), ["t1", "vps/t2"])], ["t1"]);
});

test("the keyboard walks visible cards and the child rows of expanded ones", () => {
  const a = agent("a", "idle"), b = agent("b", "working"), c = agent("c", "done");
  const groups = [{ id: "sec-2", members: [b] }, { id: "sec-1", members: [a, c] }];
  const kids = { a: [{ t: { address: "k1" } }], b: [{ t: { address: "k2" } }] };
  const order = keyOrder(groups, new Set(["sec-2"]), new Set(["a"]), (x) => kids[x.address] ?? []);
  // The folded section's card is skipped; only the expanded card lists its child.
  assert.deepEqual(order.map((o) => o.key), ["a", "a>k1", "c"]);
  assert.deepEqual(order[1], { key: "a>k1", terminal: "k1", parent: "a" });
  assert.equal(order[0].agent, a);
});

test("only live Core child terminals are navigable sub-agents", () => {
  const all = [
    { address: "t1", state: "live" },
    { address: "t2", parent: "t1", state: "live" },
    { address: "t3", parent: "t2", state: "live" },
    { address: "t4", parent: "t1", state: "finished" },
  ];
  assert.deepEqual(children(all, "t1").map((k) => [k.t.address, k.lines.join("")]), [["t2", "└"], ["t3", "└"]]);
  // A sibling after t2 turns its line into a tee and runs the rail past t2's own child.
  all.push({ address: "t5", parent: "t1", state: "live" });
  assert.deepEqual(children(all, "t1").map((k) => [k.t.address, k.lines]), [["t2", ["├"]], ["t3", ["│", "└"]], ["t5", ["└"]]]);
});
