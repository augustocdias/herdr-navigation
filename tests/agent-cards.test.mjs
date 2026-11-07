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
const { activity, parseTodo, attentionReason, cardFacts, arrange, sections, keepPresent, children, keyOrder, childAlerts, rowSpans, reveal, CARD_INSET, scrollStep, thumb, dragScroll, rowsOf } = await import("../navigation/mods/agents-enriched/main.js");

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

test("a long attention reason is kept whole", () => {
  const long = `${"Approve the staging migration ".repeat(10)}then rerun suite B`;
  assert.ok(long.length > 240);
  assert.equal(attentionReason("blocked", { state: "blocked", msg: long }), long.trim());
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

test("the keyboard walks group headers, visible cards and the child rows of expanded ones", () => {
  const a = agent("a", "idle"), b = agent("b", "working"), c = agent("c", "done");
  const groups = [{ id: "sec-2", members: [b] }, { id: "sec-1", members: [a, c] }];
  const kids = { a: [{ t: { address: "k1" } }], b: [{ t: { address: "k2" } }] };
  const order = keyOrder(groups, new Set(["sec-2"]), new Set(["a"]), (x) => kids[x.address] ?? []);
  // A folded section keeps its header, so the keyboard can open it again; its cards are skipped.
  assert.deepEqual(order.map((o) => o.key), ["sec-2", "sec-1", "a", "a>k1", "c"]);
  assert.equal(order[0].group, groups[0]);
  assert.deepEqual(order[3], { key: "a>k1", terminal: "k1", parent: "a" });
  assert.equal(order[2].agent, a);
});

test("a blocked child gives its parent a reason, or Needs attention", () => {
  const subs = [
    { t: { address: "k1", name: "reviewer", status: "blocked", report: { state: "blocked", msg: "Pick a base branch" } } },
    { t: { address: "k2", name: "docs", status: "working" } },
    { t: { address: "k3", template: "tester", status: "error", report: { state: "error" } } },
  ];
  assert.deepEqual(childAlerts(subs, new Map()), [
    { address: "k1", name: "reviewer", reason: "Pick a base branch" },
    { address: "k3", name: "tester", reason: "Needs attention" },
  ]);
  // agents() wins over the terminal's own word, as for the status badge.
  assert.deepEqual(childAlerts(subs, new Map([["k1", "working"]])).map((x) => x.address), ["k3"]);
});

test("rows stack from their measured heights, child rows inside their card", () => {
  const rows = [{ key: "sec-4" }, { key: "a", kids: ["a>k1", "a>k2"] }, { key: "b" }];
  const sizes = new Map([["sec-4", 30], ["a", 200], ["a#head", 120], ["a>k1", 24], ["a>k2", 40], ["b", 60]]);
  const spans = rowSpans(rows, sizes);
  assert.deepEqual(spans.get("a"), [30, 200]);
  assert.deepEqual(spans.get("a>k1"), [30 + CARD_INSET + 120, 24]);
  assert.deepEqual(spans.get("a>k2"), [30 + CARD_INSET + 144, 40]);
  assert.deepEqual(spans.get("b"), [230, 60]);
});

test("the list scrolls just enough to show the keyboard selection", () => {
  // Overflow: a 300px view at the top, the selected card at 400..460.
  assert.equal(reveal(0, 300, [400, 60]), 160);
  // Selection above the view scrolls up to it.
  assert.equal(reveal(160, 300, [30, 200]), 30);
  // Already visible: no movement.
  assert.equal(reveal(160, 300, [200, 50]), 160);
  // Taller than the view: its top is shown.
  assert.equal(reveal(0, 300, [100, 500]), 100);
  // Not measured yet: no movement.
  assert.equal(reveal(70, 300, undefined), 70);
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

test("a keyboard move is revealed once, then the wheel is free", () => {
  const spans = new Map([["a", [400, 60]], ["b", [0, 0]]]);
  // Revealed: the flag clears, so the next frame keeps whatever the wheel does.
  assert.deepEqual(scrollStep({ scroll: 0, reveal: true, cursor: "a", spans, view: 300, total: 900 }), { scroll: 160, reveal: false });
  // The sort button sits above the list: show the top, and clear the flag.
  assert.deepEqual(scrollStep({ scroll: 250, reveal: true, cursor: "#sort", spans, view: 300, total: 900 }), { scroll: 0, reveal: false });
  assert.deepEqual(scrollStep({ scroll: 250, reveal: false, cursor: "#sort", spans, view: 300, total: 900 }), { scroll: 250, reveal: false });
  // Not measured yet: wait for the height. Not a row at all: drop the request.
  assert.deepEqual(scrollStep({ scroll: 20, reveal: true, cursor: "b", spans, view: 300, total: 900 }), { scroll: 20, reveal: true });
  assert.deepEqual(scrollStep({ scroll: 20, reveal: true, cursor: "gone", spans, view: 300, total: 900 }), { scroll: 20, reveal: false });
  // Always inside the list: a list that shrank pulls the offset back.
  assert.deepEqual(scrollStep({ scroll: 800, reveal: false, cursor: null, spans, view: 300, total: 500 }), { scroll: 200, reveal: false });
});

test("the scroll thumb stays inside the list and drags in proportion", () => {
  assert.deepEqual(thumb(300, 600, 0), { top: 0, h: 150 });
  assert.deepEqual(thumb(300, 600, 300), { top: 150, h: 150 });
  // A very long list keeps a 16px thumb whose bottom meets the list's bottom at the end.
  assert.deepEqual(thumb(300, 10000, 9700), { top: 284, h: 16 });
  assert.equal(thumb(300, 200, 0), null);
  // Dragging the thumb by the free track's length moves through the whole list.
  assert.equal(dragScroll({ y: 100, scroll: 0 }, 250, 300, 600), 300);
  assert.equal(dragScroll({ y: 100, scroll: 300 }, 0, 300, 600), 100);
  assert.equal(dragScroll({ y: 100, scroll: 300 }, -100, 300, 600), 0);
});

test("rows and their child keys come from the keyboard order", () => {
  const order = [{ key: "#sort", sort: true }, { key: "sec-4", group: {} }, { key: "a", agent: {} }, { key: "a>k1", parent: "a" }, { key: "b", agent: {} }];
  assert.deepEqual(rowsOf(order), [{ key: "sec-4", kids: [] }, { key: "a", kids: ["a>k1"] }, { key: "b", kids: [] }]);
});
