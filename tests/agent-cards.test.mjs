// Run with `node --test`. Herdr's modules exist only inside the app, so
// they are stubbed: these checks cover what each agent card shows and in what order.
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => {}, svg = () => {}, image = () => {};",
  "gpui-base": "export const h_flex = () => {}, v_flex = () => {};",
  herdr: "export const agents = () => [], terminals = () => [], panes = () => [], focused = () => null, spaces = () => [], run = () => {}, theme = () => {}, shared = () => {}, setShared = () => {}, setAgentOrder = () => {}, openOverlay = () => {}, closeOverlay = () => {}, props = () => null, window = () => {}, layout = () => {}, nextCommand = () => new Promise(() => {});",
};
registerHooks({
  resolve: (specifier, context, next) =>
    specifier in stubs ? { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true } : next(specifier, context),
});
const { activity, activityDetails, taskLine, hoverText, wrapLine, parseTodo, attentionReason, cardFacts, arrange, sections, keepPresent, children, keyOrder, childAlerts, rowSpans, reveal, CARD_INSET, scrollStep, thumb, dragScroll, rowsOf, pageScroll, railOrder } = await import("../navigation/mods/agents-enriched/main.js");

const NOW = 1_000_000;
const tokens = { agent: "claude-opus", title: "Fix login", todo: "2/5 Writing tests", sub1: "Explore: find callers", sub2: "", sub3: "", submore: "" };
const label = (extra = {}, terminal = {}, details) => ({
  state: "live",
  program: { key: "claude" },
  labels: { "nix.activity": JSON.stringify({ version: 1, session: "s-1", expires: NOW + 1000, agent: "claude", tokens: { ...tokens, ...extra }, ...(details ? { details } : {}) }) },
  ...terminal,
});
const full = {
  model: "claude-opus-4",
  title: "Fix the login redirect loop after the session cookie expires",
  workspace: "/home/u/web/packages/auth",
  branch: "fix/login-redirect",
  tasks: { completed: 3, total: 7, active: ["Writing tests", "Updating the changelog"] },
  subagents: { total: 4, items: [{ id: "toolu_t2", type: "Explore", description: "find callers of redirect()" }, { id: "a9", type: "Plan", description: "" }] },
};
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

test("token limits count code points, so astral text up to 80 is kept and longer is rejected", () => {
  const astral = "\u{1F600}";
  assert.equal(activity(label({ title: astral.repeat(80) }), NOW).title, astral.repeat(80));
  assert.equal(activity(label({ title: "x".repeat(80), todo: astral.repeat(41) }), NOW).todo, astral.repeat(41));
  assert.equal(activity(label({ title: astral.repeat(81) }), NOW), null);
  assert.equal(activity(label({ sub1: astral.repeat(81) }), NOW), null);
});

test("Smart Tabs and the Agent Picker read the label with the same activity() as the cards", async () => {
  const body = async (mod) => /function activity\([\s\S]*?\n\}\n/.exec(await readFile(new URL(`../navigation/mods/${mod}/main.js`, import.meta.url), "utf8"))[0];
  const cards = await body("agents-enriched");
  assert.equal(await body("tabs-enriched"), cards);
  assert.equal(await body("picker-enriched"), cards);
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

// Shapes the harnesses' own OSC 7501 reports take once Core has decoded them.
const omp = (kind, msg) => ({ app: "omp", state: "blocked", kind, msg });
test("supported reporters give their own reason; others read Needs attention", () => {
  assert.equal(attentionReason("blocked", omp("permission", "Allow bash: npm test")), "Allow bash: npm test");
  assert.equal(attentionReason("blocked", omp("question", "Which base branch?")), "Which base branch?");
  assert.equal(attentionReason("blocked", { app: "claude-code", state: "blocked", kind: "auth" }), "Needs sign-in");
  // A program that reports blocked with no kind or message, or a kind nobody defined.
  assert.equal(attentionReason("blocked", { app: "codex", state: "blocked" }), "Needs attention");
  assert.equal(attentionReason("blocked", { app: "pi", state: "blocked", kind: "review" }), "Needs attention");
});

test("a malformed or oversized message is ignored, never shown in part", () => {
  const max = "é".repeat(2048);
  assert.equal(attentionReason("blocked", omp("question", max)), max);
  // Checked before spaces are collapsed: a newline is a control character, and a double space
  // doesn't bring an oversized message under the bound.
  for (const msg of [42, { text: "x" }, ["Allow?"], "   ", "Allow\u001b[31m rm", "Allow\u0000 rm", "Allow\nrm", "é".repeat(2049), `a  ${"b".repeat(2046)}`]) {
    assert.equal(attentionReason("blocked", omp("permission", msg)), "Waiting for permission", JSON.stringify(msg).slice(0, 40));
    assert.equal(attentionReason("blocked", { state: "blocked", msg }), "Needs attention");
  }
  assert.equal(attentionReason("blocked", "blocked"), "Needs attention");
});

// Native transitions from a private Core and App: real OMP and Claude starts and exits after a
// synthetic stale report, and a synthetic emitter for rejected reports (see the fixture's source).
const native = JSON.parse(await readFile(new URL("./fixtures/native-attention.json", import.meta.url), "utf8"));
const replay = (steps) => steps.map((s) => [s.event, attentionReason(s.status, s.report)]);
const OLD = "Old permission from the previous session";

test("a reason clears once Core accepts a newer report", () => {
  assert.deepEqual(replay(native.omp), [
    ["stale report", OLD], ["omp starts", null], ["omp gets SIGTERM", null],
    ["stale report", OLD], ["omp starts", null], ["omp gets SIGKILL", null],
  ]);
  // Claude sends its first report (idle) only after its trust prompt; a fresh terminal here.
  assert.deepEqual(replay(native.claudeTrusted), [["claude starts, trust prompt open", null], ["trust accepted", null]]);
  // A resolved blocker (synthetic emitter): the next accepted report, bare blocked or working, drops the message.
  assert.deepEqual(replay(native.rejected).slice(3), [["bare blocked", "Needs attention"], ["working", null]]);
  // agents() already moved on while the terminal still holds the blocked report: no reason.
  for (const status of ["working", "idle", "done"]) assert.equal(attentionReason(status, native.omp[0].report), null);
});

// Known limit, not a guarantee: Core keeps its last accepted report, blocked state included,
// until a new one is accepted, and gives mods no session, report id or reporter to tell.
test("without a new accepted report, Core's last blocked reason stays", () => {
  assert.deepEqual(replay(native.claude), [
    ["stale report", OLD], ["claude starts, trust prompt open", OLD], ["claude gets SIGTERM", null],
    ["stale report", OLD], ["claude starts, trust prompt open", OLD], ["claude gets SIGKILL", OLD],
  ]);
  assert.deepEqual(replay(native.rejected).slice(0, 3), [
    ["blocked with a message", "Old permission"],
    ["blocked question with a newline: Core rejects it", "Old permission"],
    ["blocked question of 2049 bytes: Core rejects it", "Old permission"],
  ]);
});

test("a reason never comes from the activity label, its tasks or its freshness", () => {
  const blocked = agent("t1", "blocked");
  // Live label with a title and a task, but a report without a reason.
  assert.equal(cardFacts(blocked, label({}, { report: { state: "blocked" } }), null, "1", NOW).attention, "Needs attention");
  // An expired label next to a reported reason: the reason is the report's alone.
  const expired = label({}, { report: omp("question", "Which base branch?") });
  assert.equal(cardFacts(blocked, expired, null, "1", NOW + 5000).attention, "Which base branch?");
  // A working agent with a long-quiet label still has no reason.
  assert.equal(cardFacts(agent("t1", "working"), label(), null, "1", NOW).attention, null);
});

test("a blocked grandchild marks its top parent; finished or calm children do not", () => {
  const all = [
    { address: "t1", state: "live" },
    { address: "t2", parent: "t1", state: "live", name: "lead", status: "working" },
    { address: "t3", parent: "t2", state: "live", name: "reviewer", status: "blocked", report: omp("question", "Squash or merge?") },
    { address: "t4", parent: "t1", state: "finished", name: "gone", status: "blocked", report: omp("question", "Old question") },
    { address: "t5", parent: "t1", state: "live", name: "docs", status: "done" },
  ];
  assert.deepEqual(childAlerts(children(all, "t1"), new Map()), [{ address: "t3", name: "reviewer", reason: "Squash or merge?" }]);
  // The child's question was answered: its next report says working, and the alert goes.
  all[2] = { ...all[2], status: "working", report: { app: "omp", state: "working" } };
  assert.deepEqual(childAlerts(children(all, "t1"), new Map()), []);
});

test("a child alert lifts its parent in priority sections only; space groups stay put", () => {
  const list = [agent("p", "working", { space: "s1", space_name: "web" }), agent("q", "idle", { space: "s2", space_name: "api" })];
  const lifted = new Map([["p", 4], ["q", 1]]);
  const rankOf = (a) => lifted.get(a.address);
  const byPriority = sections(arrange(list, rankOf, () => 0, true), rankOf, true);
  assert.deepEqual(byPriority.map((g) => [g.label, g.members.map((a) => a.address)]), [["Needs you", ["p"]], ["Idle", ["q"]]]);
  const grouped = sections(arrange(list, rankOf, () => 0, false), rankOf, false);
  assert.deepEqual(grouped.map((g) => [g.label, g.members.map((a) => a.address)]), [["web", ["p"]], ["api", ["q"]]]);
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

test("the keyboard selection stays in view while the list changes under it", () => {
  const step = (o) => scrollStep({ view: 300, total: 900, keyboard: true, ...o });
  // An expanded child selected at 200..230, in view.
  let spans = new Map([["a>k1", [200, 30]]]);
  assert.deepEqual(step({ scroll: 0, follow: true, cursor: "a>k1", spans }), { scroll: 0, follow: true });
  // Another blocked child lengthens the parent's reason: the child moves to 420..450.
  // Following persists across frames, so the next frame brings it back.
  spans = new Map([["a>k1", [420, 30]]]);
  assert.deepEqual(step({ scroll: 0, follow: true, cursor: "a>k1", spans }), { scroll: 150, follow: true });
  // After the wheel (follow off), changes leave the offset alone.
  assert.deepEqual(step({ scroll: 0, follow: false, cursor: "a>k1", spans }), { scroll: 0, follow: false });
  // Without the keyboard on the list there is no visible selection to follow.
  assert.deepEqual(step({ scroll: 0, follow: true, cursor: "a>k1", spans, keyboard: false }), { scroll: 0, follow: true });
});

test("selection outside the list rows does not fight the scroll", () => {
  const spans = new Map([["a", [400, 60]], ["b", [0, 0]]]);
  const step = (o) => scrollStep({ view: 300, total: 900, keyboard: true, follow: true, spans, ...o });
  // The sort button sits above the list: show the top.
  assert.deepEqual(step({ scroll: 250, cursor: "#sort" }), { scroll: 0, follow: true });
  // The rail's expand control sits below it: leave the offset.
  assert.deepEqual(step({ scroll: 250, cursor: "#expand" }), { scroll: 250, follow: true });
  // Not measured yet: wait. Not a row at all: stop following.
  assert.deepEqual(step({ scroll: 20, cursor: "b" }), { scroll: 20, follow: true });
  assert.deepEqual(step({ scroll: 20, cursor: "gone" }), { scroll: 20, follow: false });
  // Always inside the list: a list that shrank pulls the offset back.
  assert.deepEqual(scrollStep({ scroll: 800, follow: false, cursor: null, spans, view: 300, total: 500, keyboard: true }), { scroll: 200, follow: false });
});

test("Page Up, Page Down, Home and End scroll through content taller than the list", () => {
  // A 1000px reason in a 300px list: Page Down steps keep 40px of overlap and reach the end.
  assert.equal(pageScroll("pagedown", 0, 300, 1000), 260);
  assert.equal(pageScroll("pagedown", 600, 300, 1000), 700);
  assert.equal(pageScroll("pageup", 260, 300, 1000), 0);
  assert.equal(pageScroll("end", 0, 300, 1000), 700);
  assert.equal(pageScroll("home", 500, 300, 1000), 0);
  assert.equal(pageScroll("down", 500, 300, 1000), null);
});

test("the rail keeps a keyboard order: its agents, then the way back to cards", () => {
  const a = agent("a", "idle"), b = agent("b", "blocked");
  assert.deepEqual(railOrder([b, a]).map((o) => o.key), ["b", "a", "#expand"]);
  assert.equal(railOrder([b, a])[0].agent, b);
  assert.deepEqual(railOrder([]), [{ key: "#expand", expand: true }]);
});

test("the shipped keys fragment gives the agents list a keyboard entry", async () => {
  const keys = JSON.parse(await readFile(new URL("../keys.json", import.meta.url), "utf8"));
  assert.equal(keys.global["alt-a"], "agents-enriched.focus");
  assert.equal(keys.global["alt-w"], "mod.open:picker-enriched");
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
  // The rail's expand control sits below the rows, like the sort button above them.
  assert.deepEqual(rowsOf([{ key: "a", agent: {} }, { key: "#expand", expand: true }]), [{ key: "a", kids: [] }]);
});

test("complete details fill the expanded card, beside the unchanged title", () => {
  const pane = { cwd: "/home/u/web", branch: "main" };
  const f = cardFacts(agent("t1", "working"), label({}, {}, full), pane, "1", NOW);
  // The header keeps the token title; the details carry the long one.
  assert.equal(f.title, "Fix login");
  assert.equal(f.fullTitle, full.title);
  assert.equal(f.model, "claude-opus-4");
  // The reporter's working directory and branch win over the pane's.
  assert.equal(f.folder, "/home/u/web/packages/auth");
  assert.equal(f.branch, "fix/login-redirect");
  assert.equal(f.workspace, "web");
  assert.deepEqual(f.progress, { done: 3, total: 7 });
  assert.equal(f.task, "Writing tests");
  assert.deepEqual(f.tasks, ["Writing tests", "Updating the changelog"]);
  assert.deepEqual(f.reported, ["Explore: find callers of redirect()", "Plan", "2 more"]);
  assert.equal(f.reportedTotal, 4);
});

test("the compact row stays one line: counts and the first active task", () => {
  const f = cardFacts(agent("t1", "working"), label({}, {}, full), null, "1", NOW);
  assert.equal(taskLine(f), "3/7 · Writing tests");
  assert.equal(taskLine(cardFacts(agent("t1", "working"), label({ todo: "0/3" }), null, "1", NOW)), "0/3");
  assert.equal(taskLine(cardFacts(agent("t1", "working"), null, null, "1", NOW)), null);
});

test("partial details fill only their fields; the rest comes from tokens and the pane", () => {
  const pane = { cwd: "/home/u/web", branch: "main" };
  const f = cardFacts(agent("t1", "working"), label({}, {}, { model: "gpt-5" }), pane, "1", NOW);
  assert.equal(f.model, "gpt-5");
  assert.equal(f.fullTitle, "Fix login");
  assert.equal(f.folder, "/home/u/web");
  assert.equal(f.branch, "main");
  assert.deepEqual(f.progress, { done: 2, total: 5 });
  assert.deepEqual(f.tasks, ["Writing tests"]);
  assert.deepEqual(f.reported, ["Explore: find callers"]);
  assert.equal(f.reportedTotal, null);
  // Counts without an active task: no task, still the counts.
  const counts = cardFacts(agent("t1", "working"), label({}, {}, { tasks: { completed: 0, total: 2, active: [] } }), null, "1", NOW);
  assert.deepEqual(counts.progress, { done: 0, total: 2 });
  assert.equal(counts.task, null);
});

test("long text up to the contract's limits is kept whole; longer fields are dropped", () => {
  const long = { title: "t".repeat(300), workspace: "/" + "w".repeat(511), branch: "b".repeat(200), model: "m".repeat(128),
    tasks: { completed: 1, total: 1, active: ["a".repeat(200)] }, subagents: { total: 1, items: [{ id: "i".repeat(128), type: "y".repeat(64), description: "d".repeat(200) }] } };
  const f = cardFacts(agent("t1", "working"), label({}, {}, long), null, "1", NOW);
  assert.equal(f.fullTitle, long.title);
  assert.equal(f.folder, long.workspace);
  assert.equal(f.branch, long.branch);
  assert.equal(f.model, long.model);
  assert.deepEqual(f.tasks, [long.tasks.active[0]]);
  assert.deepEqual(f.reported, [`${"y".repeat(64)}: ${"d".repeat(200)}`]);
  // Code points, not UTF-16 units: 300 emoji are within the title limit.
  assert.equal(activityDetails(label({}, {}, { title: "😀".repeat(300) }), NOW).title, "😀".repeat(300));
  const over = cardFacts(agent("t1", "working"), label({}, {}, { title: "t".repeat(301), model: "m".repeat(129), branch: "b".repeat(201) }), null, "1", NOW);
  assert.equal(over.fullTitle, "Fix login");
  assert.equal(over.model, "claude-opus");
  assert.equal(over.branch, null);
});

test("malformed details are ignored field by field, never trusted", () => {
  const read = (details) => activityDetails(label({}, {}, details), NOW);
  assert.equal(read({ tasks: { completed: 3, total: 2, active: [] } }).tasks, null);
  assert.equal(read({ tasks: { completed: 0, total: 0, active: [] } }).tasks, null);
  assert.equal(read({ tasks: { completed: true, total: 2, active: [] } }).tasks, null);
  assert.equal(read({ tasks: { completed: 1.5, total: 2, active: [] } }).tasks, null);
  assert.equal(read({ tasks: { completed: 1, total: 10001, active: [] } }).tasks, null);
  assert.equal(read({ tasks: { completed: 1, total: 2, active: ["a", "b", "c", "d", "e", "f"] } }).tasks, null);
  assert.equal(read({ tasks: { completed: 1, total: 2, active: [""] } }).tasks, null);
  assert.equal(read({ subagents: { total: 1, items: [{ id: "a", type: "x", description: "" }, { id: "b", type: "y", description: "" }] } }).subagents, null);
  assert.equal(read({ subagents: { total: 2, items: [{ id: "a", type: "x", description: "" }, { id: "a", type: "y", description: "" }] } }).subagents, null);
  assert.equal(read({ subagents: { total: 1, items: [{ id: "a", type: "", description: "" }] } }).subagents, null);
  assert.equal(read({ subagents: { total: 0, items: [] } }).subagents, null);
  assert.equal(read({ subagents: "Explore" }).subagents, null);
  assert.equal(read({ model: "line\nbreak" }).model, null);
  assert.equal(read({ model: 42 }).model, null);
  // A bad field leaves the good ones, and the tokens, in place.
  const f = cardFacts(agent("t1", "working"), label({}, {}, { model: "gpt-5", tasks: { completed: 9, total: 2, active: [] } }), null, "1", NOW);
  assert.equal(f.model, "gpt-5");
  assert.deepEqual(f.progress, { done: 2, total: 5 });
  // details that are not an object are no details.
  for (const bad of [null, [], "x", 3]) assert.equal(activityDetails(label({}, {}, bad), NOW), null);
});

test("older reports without details read exactly as before", () => {
  const pane = { cwd: "/home/u/web", branch: "fix-login" };
  const f = cardFacts(agent("t1", "working"), label(), pane, "1", NOW);
  assert.equal(activityDetails(label(), NOW), null);
  assert.equal(f.fullTitle, "Fix login");
  assert.equal(f.model, "claude-opus");
  assert.equal(f.folder, "/home/u/web");
  assert.deepEqual(f.tasks, ["Writing tests"]);
  assert.equal(taskLine(f), "2/5 · Writing tests");
});

test("expired, foreign or rejected labels show no details either", () => {
  const expired = label({}, {}, full);
  expired.labels["nix.activity"] = expired.labels["nix.activity"].replace(`"expires":${NOW + 1000}`, `"expires":${NOW - 1}`);
  assert.equal(activityDetails(expired, NOW), null);
  assert.equal(activityDetails(label({}, { program: { key: "codex" } }, full), NOW), null);
  assert.equal(activityDetails(label({}, { state: "finished" }, full), NOW), null);
  // Tokens the reader rejects take the details with them.
  assert.equal(activityDetails(label({ title: "x".repeat(81) }, {}, full), NOW), null);
  const f = cardFacts(agent("t1", "idle"), expired, { cwd: "/home/u/web" }, "Review", NOW);
  assert.equal(f.model, null);
  assert.equal(f.folder, "/home/u/web");
  assert.deepEqual(f.reported, []);
  assert.deepEqual(f.tasks, []);
});

test("a new session shows only what its own report says", () => {
  const before = cardFacts(agent("t1", "working"), label({}, {}, full), null, "1", NOW);
  assert.equal(before.model, "claude-opus-4");
  // The reporter replaced the label for a new session, without details yet.
  const next = label({ title: "New chat", todo: "", sub1: "" }, {});
  next.labels["nix.activity"] = next.labels["nix.activity"].replace('"s-1"', '"s-2"');
  const after = cardFacts(agent("t1", "working"), next, null, "1", NOW);
  assert.equal(after.title, "New chat");
  assert.equal(after.model, "claude-opus");
  assert.equal(after.progress, null);
  assert.deepEqual(after.reported, []);
  // Empty tokens clear the enrichment: details beside them are ignored.
  const cleared = label({ agent: "", title: "", todo: "", sub1: "" }, {}, full);
  assert.equal(activityDetails(cleared, NOW), null);
  // Only the seven known tokens count: an extra key doesn't undo the clearing.
  assert.equal(activityDetails(label({ agent: "", title: "", todo: "", sub1: "", extra: "x" }, {}, full), NOW), null);
});

test("reported sub-agents are text: no terminal, even when an id looks like one", () => {
  // The reporter's item id equals a live terminal's address; it must not become a row.
  const items = [{ id: "t2", type: "Explore", description: "callers" }];
  const f = cardFacts(agent("t1", "working"), label({}, {}, { subagents: { total: 1, items } }), null, "1", NOW);
  assert.deepEqual(f.reported, ["Explore: callers"]);
  assert.ok(!JSON.stringify(f).includes('"t2"'));
  const all = [{ address: "t1", state: "live" }, { address: "t2", state: "live" }];
  const order = keyOrder([{ id: "sec-2", members: [agent("t1", "working")] }], new Set(), new Set(["t1"]), (a) => children(all, a.address));
  assert.deepEqual(order.map((o) => o.key), ["sec-2", "t1"]);
});

test("long tooltip lines wrap into rows of at most 64 code points, losing nothing", () => {
  const branch = "feature/" + "b".repeat(192), folder = "/home/u/" + "\u{1F600}d/".repeat(168);
  const f = cardFacts(agent("t1", "working"), label({}, {}, { ...full, branch, workspace: folder, title: "word ".repeat(60).trim() }), null, "1", NOW);
  const text = hoverText(f, []);
  for (const row of text.split("\n")) assert.ok([...row].length <= 64, row);
  assert.ok(text.replace(/\n/g, "").includes(`Branch ${branch}`));
  assert.ok(text.replace(/\n/g, "").includes(`Folder ${folder}`));
  // Prose breaks at a space, which the break replaces.
  assert.equal(wrapLine("aaaa bbbb cccc", 10), "aaaa bbbb\ncccc");
  assert.equal(wrapLine("x".repeat(64)), "x".repeat(64));
  // A space in the row's first half is kept; the word after it is cut instead.
  assert.equal(wrapLine("ab " + "x".repeat(10), 10), "ab xxxxxxx\nxxx");
  // Rows of a multi-line reason are wrapped one by one.
  assert.equal(hoverText(cardFacts(agent("t3", "idle"), null, null, "2", NOW), ["one\ntwo"]), "Claude Code\none\ntwo");
});

test("the hover summary previews the details, which stay on the card without it", () => {
  const f = cardFacts(agent("t1", "working"), label({}, {}, full), { cwd: "/x" }, "1", NOW);
  assert.equal(hoverText(f, []), [
    "Fix login", "3/7 · Writing tests", "Model claude-opus-4", "Branch fix/login-redirect",
    "Folder /home/u/web/packages/auth", "4 reported sub-agents, no terminal",
  ].join("\n"));
  // A reason replaces the task; a legacy list without a total gives no count.
  const legacy = cardFacts(agent("t1", "blocked"), label(), null, "1", NOW);
  assert.equal(hoverText(legacy, ["Needs attention"]), ["Fix login", "Needs attention", "Model claude-opus", "Reported sub-agents, no terminal"].join("\n"));
  assert.equal(hoverText(cardFacts(agent("t3", "idle"), null, null, "2", NOW), []), "Claude Code");
});
