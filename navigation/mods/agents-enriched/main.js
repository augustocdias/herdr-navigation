// Agent Cards: Herdr's agents list, one card per agent, in priority sections or grouped
// by space. Parents take their most urgent sub-agent's place. A viewed done agent stays
// in Done until left. A card shows the session title, harness icon, status, and why it
// needs you or what it is doing; its disclosure button shows the rest. No agent pins.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const oneLine = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
const STATUS_WORD = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Labels survive Core recovery; only a live reporter's lease may reach the UI.
// Keep in step with the same helper in tabs-enriched.
export function activity(terminal, now = Date.now()) {
  if (terminal?.state !== "live") return null;
  try {
    const data = JSON.parse(terminal.labels?.["nix.activity"] ?? "null");
    if (data?.version !== 1 || !Number.isFinite(data.expires) || data.expires <= now) return null;
    if (terminal.program?.key !== data.agent) return null;
    const tokens = data.tokens;
    if (!tokens || ["agent", "title", "todo", "sub1", "sub2", "sub3", "submore"].some(k => typeof tokens[k] !== "string" || tokens[k].length > 80)) return null;
    return tokens;
  } catch {
    return null;
  }
}

// The reporter's checklist summary, "2/5 Writing tests": counts, then the active task.
export function parseTodo(todo) {
  const m = /^(\d+)\/(\d+)(?:\s+(.*))?$/.exec(oneLine(todo));
  return m ? { done: Number(m[1]), total: Number(m[2]), task: m[3] ?? "" } : null;
}

// Why a blocked agent needs you: its 7501 report's own message, whole, or kind while that
// report is the blocked one, else "Needs attention". Other states have no reason.
const KIND = { permission: "Waiting for permission", question: "Has a question", auth: "Needs sign-in" };
export function attentionReason(status, report) {
  if (status !== "blocked") return null;
  if (report?.state === "blocked") {
    const msg = oneLine(report.msg);
    if (msg) return msg;
    if (KIND[report.kind]) return KIND[report.kind];
  }
  return "Needs attention";
}

const childName = (k) => k.name || k.template || k.program?.name || k.address;

// Core children that need you, each with its reason: these lift the parent into Needs you,
// so the parent's card says why. `listed`: agents() statuses, which win as in kidStatus.
export function childAlerts(subs, listed) {
  return subs.filter((s) => kidStatus(s.t, listed) === "blocked")
    .map((s) => ({ address: s.t.address, name: childName(s.t), reason: attentionReason("blocked", s.t.report) }));
}

// What a card shows, from native data and, while it is valid, the `nix.activity` label.
// `label`: the agent's tab label (see `title`). Missing fields are null, never guessed.
export function cardFacts(a, terminal, pane, label, now = Date.now()) {
  const act = activity(terminal, now);
  const todo = act?.todo ? parseTodo(act.todo) : null;
  const reported = act ? ["sub1", "sub2", "sub3"].map(k => act[k]).filter(Boolean) : [];
  if (act?.submore) reported.push(`More: ${act.submore}`);
  const tabLabel = label && !/^\d+$/.test(label) ? label : "";
  return {
    title: oneLine(act?.title) || oneLine(terminal?.report?.title) || tabLabel || a.program?.name || oneLine(a.title) || a.address,
    attention: attentionReason(a.status, terminal?.report),
    task: (todo ? todo.task : oneLine(act?.todo)) || null,
    progress: todo ? { done: todo.done, total: todo.total } : null,
    model: oneLine(act?.agent) || null,
    workspace: a.space_name || null,
    folder: pane?.cwd || null,
    branch: pane?.branch || null,
    reported,
  };
}

// Priority order, or agents() order when grouped by space. Agent pins are gone: any
// stored in localStorage by Herdr's agents list are never read.
export function arrange(list, rankOf, since, byPriority) {
  return byPriority ? [...list].sort((x, y) => rankOf(y) - rankOf(x) || since(y) - since(x) || y.seq - x.seq) : list;
}

// Groups in list order: spaces (grouped) or priority sections. Agents of a
// space are next to each other in agents(), so neighbours make a group.
export function sections(list, rankOf, byPriority) {
  const groups = [];
  for (const a of list) {
    const r = rankOf(a) || RANK.idle;
    const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
    if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
    else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
  }
  return groups;
}

// Expanded cards whose agent is still listed. Only for machines the list has heard from:
// right after a start, or while a machine connects, its agents aren't listed yet.
const machineOf = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
export function keepPresent(expanded, addresses) {
  const listed = new Set(addresses), heard = new Set(addresses.map(machineOf));
  return new Set([...expanded].filter((a) => !heard.has(machineOf(a)) || listed.has(a)));
}

// What Up and Down walk: every group header (Enter folds or unfolds it), the cards of
// unfolded groups, and each expanded card's Core child rows. `kidsOf(agent)`: its children().
export function keyOrder(groups, folded, expanded, kidsOf) {
  return groups.flatMap((g) => [{ key: g.id, group: g }, ...(folded.has(g.id) ? [] : g.members.flatMap((a) => [
    { key: a.address, agent: a },
    ...(expanded.has(a.address) ? kidsOf(a).map((s) => ({ key: `${a.address}>${s.t.address}`, terminal: s.t.address, parent: a.address })) : []),
  ]))]);
}

// The list scrolls itself (GPUI gives a script no way to scroll an ordinary element into
// view), so it needs each row's place. A row's measured height includes its spacing; a
// card's child rows sit CARD_INSET plus its head block below the card's top.
const CARD_GAP = 3, CARD_BORDER = 1, CARD_PAD = 7;
export const CARD_INSET = CARD_GAP + CARD_BORDER + CARD_PAD;
export function rowSpans(rows, sizes) {
  const spans = new Map();
  let y = 0;
  for (const r of rows) {
    const h = sizes.get(r.key) ?? 0;
    spans.set(r.key, [y, h]);
    let ky = y + CARD_INSET + (sizes.get(`${r.key}#head`) ?? 0);
    for (const k of r.kids ?? []) {
      const kh = sizes.get(k) ?? 0;
      spans.set(k, [ky, kh]);
      ky += kh;
    }
    y += h;
  }
  return spans;
}

// The scroll offset that shows `span` ([top, height]) in a `view`-tall list, moving as
// little as possible; a row taller than the view shows its top.
// rowSpans input from keyOrder: headers and cards, each card with its child row keys.
export function rowsOf(order) {
  const rows = [];
  for (const o of order) {
    if (o.parent) rows.at(-1)?.kids.push(o.key);
    else if (!o.key.startsWith("#")) rows.push({ key: o.key, kids: [] });
  }
  return rows;
}

// One frame's scroll offset. While `follow` is on (a selection key was pressed; the wheel,
// the thumb and the page keys turn it off) and the list has the keyboard, every frame keeps
// the selection in view, so rows that grow, move or appear above it can't push it out.
// Keys starting with "#" are controls outside the rows: the sort button above, the rail's
// expand control below.
export function scrollStep({ scroll, follow, cursor, spans, view, total, keyboard }) {
  let next = scroll;
  if (follow && keyboard) {
    if (cursor === "#sort") next = 0;
    else if (String(cursor).startsWith("#")) { /* below the rows: nothing to show */ }
    else if (!spans.has(cursor)) follow = false;
    else if (spans.get(cursor)[1]) next = reveal(scroll, view, spans.get(cursor));
  }
  return { scroll: Math.max(0, Math.min(next, Math.max(0, total - view))), follow };
}

// Page Up/Down move by a page less 40px of overlap, Home/End go to either end; null for
// other keys. They read what is in the list, a reason taller than it included.
export function pageScroll(key, scroll, view, total) {
  const max = Math.max(0, total - view), page = Math.max(view - 40, 20);
  const to = { pagedown: scroll + page, pageup: scroll - page, home: 0, end: max }[key];
  return to === undefined ? null : Math.max(0, Math.min(max, to));
}

// The narrow rail's keyboard order: its numbered agents, then the control back to cards.
export function railOrder(list) {
  return [...list.map((a) => ({ key: a.address, agent: a })), { key: "#expand", expand: true }];
}

// The scroll thumb's place, or null when the list fits; at least 16px tall.
export function thumb(view, total, scroll) {
  if (total <= view) return null;
  const h = Math.max(16, (view * view) / total);
  return { top: ((view - h) * scroll) / (total - view), h };
}

// The offset while dragging the thumb from `start` ({ y, scroll }) to pointer `y`.
export function dragScroll(start, y, view, total) {
  const max = Math.max(0, total - view), t = thumb(view, total, start.scroll);
  if (!t) return 0;
  return Math.max(0, Math.min(max, start.scroll + ((y - start.y) * max) / (view - t.h)));
}

export function reveal(scroll, view, span) {
  if (!span || !view) return scroll;
  const [top, h] = span;
  if (top < scroll || h > view) return top;
  return top + h > scroll + view ? top + h - view : scroll;
}

// Live Core child terminals of `addr`, depth first, each with the tree lines in front of it.
// Only these are navigable: they are real terminals, unlike sub-agents an agent reports.
export function children(all, addr, lines = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lines, last ? "└" : "├"] },
      ...children(all, k.address, [...lines, last ? "" : "│"]),
    ];
  });
}

export default class Agents extends View {
  init(_props, cx) {
    // The sort menu is this mod opened as a popup: it takes the keyboard (Up/Down, Enter, Escape).
    if (props()?.sortMenu) {
      this.at = Math.max(0, SORTS.indexOf(sortOf()));
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.folded = new Set();
    this.expanded = new Set();
    this.cursor = null;
    this.keys = cx.focus_handle();
    this.sizes = new Map(); // row key -> measured height (see rowSpans)
    this.scroll = 0;
    this.view = 0;
    this.follow = false; // keep the keyboard selection in view (see scrollStep)
    this.drag = null; // { y, scroll } while the scroll thumb is dragged
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
    // Key commands (keys.json: "<key>": "agents-enriched.focus"):
    // `focus` gives the list the keyboard; `details` shows or hides details of the card under
    // the keyboard, else of the shown agent.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.keys.focus();
        else if (command === "details") {
          const list = agents();
          // On a child row, its card; on a header or the sort button, the agent on screen.
          const under = this.keys.is_focused() ? String(this.cursor).split(">")[0] : null;
          const a = list.find((k) => k.address === under) || list.find((k) => k.focused);
          if (a) { this.cursor = a.address; this.toggle(a.address); this.follow = true; }
        }
        cx.notify();
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  // Records a row's height for rowSpans; a change redraws so the scroll can follow it.
  measure(key) {
    return (size, cx) => {
      if (this.sizes.get(key) === size.height) return;
      this.sizes.set(key, size.height);
      cx.notify();
    };
  }

  // Only the disclosure button and the keyboard change what is expanded; status never does.
  toggle(address, open = !this.expanded.has(address)) {
    if (open) this.expanded.add(address);
    else this.expanded.delete(address);
  }

  sortMenu(t) {
    const on = sortOf().id;
    const choose = (s) => {
      setShared("agents.sort", s.id);
      closeOverlay(props().overlay);
    };
    return v_flex()
      .id("sort-menu")
      .track_focus(this.handle)
      .role("menu")
      .accessibility_label("Sort agents")
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" || e.key === "up") this.at = (this.at + (e.key === "down" ? 1 : SORTS.length - 1)) % SORTS.length;
        else if (e.key === "enter" || e.key === "space") return choose(SORTS[this.at]);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s, i) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .role("menu_item")
        .aria_selected(i === this.at)
        .accessibility_label(`${s.label}${s.id === on ? ", current" : ""}`)
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover))
        .on_click(() => choose(s))
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  // A Core child terminal inside an expanded card; a click peeks at it. A blocked child
  // shows its reason under its name.
  subRow(t, s, parent, shown, current) {
    const k = s.t;
    const key = `${parent}>${k.address}`;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 13, t.foreground);
    const on = k.address === shown;
    const name = childName(k);
    const reason = st === "blocked" ? attentionReason("blocked", k.report) : null;
    return v_flex()
      .id(`sub-${key}`)
      .on_size_change(this.measure(key))
      .pr(4)
      .pb(reason ? 4 : 0)
      .rounded(6)
      .flex_none()
      .text_size(12)
      .cursor_pointer()
      .role("button")
      .accessibility_label(`Peek at sub-agent ${name}, ${STATUS_WORD[st] ?? st}${reason ? `, ${reason}` : ""}`)
      .border(1)
      .border_color(current ? t.accent : t.dim + "00")
      .when(on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.peek", { terminal: k.address }); })
      .child(h_flex().h(24).items_center()
        .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(16).mr(4).flex_none()
          .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
          .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
        .when(Boolean(pic), el => el.child(div().mr(6).child(pic)))
        .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(name))
        .child(this.status(t, { status: st }, true)))
      .when(Boolean(reason), el => el.child(div().pl(13 * s.lines.length + (pic ? 19 : 0)).text_size(11.5).whitespace_normal().text_color(t.blocked).child(reason)));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  // One "Name  value" line of an expanded card; long values wrap.
  fact(t, id, name, value) {
    return h_flex().id(id).gap(8).items_start().text_size(11.5)
      .child(div().w(64).flex_none().text_color(t.dim).child(name))
      .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.foreground).child(value));
  }

  details(t, a, f, subs) {
    const id = (k) => `${k}-${a.address}`;
    const progress = f.progress ? `${f.progress.done} of ${f.progress.total} done` : null;
    const workspace = [f.workspace, f.folder].filter(Boolean).join(" · ");
    return v_flex().id(id("details")).pt(6).mt(2).gap(4).border_t(1).border_color(t.border)
      .child(this.fact(t, id("title"), "Title", f.title))
      .when(Boolean(f.task || progress), el => el.child(this.fact(t, id("task"), "Task", [progress, f.task].filter(Boolean).join(" · "))))
      .when(!f.task && !progress, el => el.child(this.fact(t, id("task"), "Task", "None reported")))
      .child(this.fact(t, id("model"), "Model", f.model ?? "Not reported"))
      .when(Boolean(workspace), el => el.child(this.fact(t, id("workspace"), "Workspace", workspace)))
      .child(this.fact(t, id("branch"), "Branch", f.branch ?? "No branch"))
      .when(f.reported.length > 0, el => el.child(v_flex().id(id("reported")).gap(2)
        .child(div().text_size(11.5).text_color(t.dim).child("Reported by the agent"))
        .children(f.reported.map((text, i) => div().id(id(`reported-${i}`)).pl(8).text_size(11.5).whitespace_normal().text_color(t.muted).child(text)))))
      // The child rows follow the details inside the card (see card).
      .when(subs.length > 0, el => el.child(div().id(id("subs")).text_size(11.5).text_color(t.dim).child("Sub-agents")));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const byAddress = new Map(all.map((k) => [k.address, k]));
    const paneList = panes();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    this.expanded = keepPresent(this.expanded, list.map((a) => a.address));
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...children(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    list = arrange(list, rankOf, (a) => this.since(a), byPriority);
    setAgentOrder(list.map((a) => a.address));
    const groups = sections(list, rankOf, byPriority);
    // The sort button comes first: Tab doesn't reach it, Up from the first header does.
    const order = collapsed ? railOrder(list) : [{ key: "#sort", sort: true }, ...keyOrder(groups, this.folded, this.expanded, (a) => children(all, a.address))];
    if (!order.some((o) => o.key === this.cursor)) {
      // Its row went (folded, ended): start over at the first card, without a jump.
      this.cursor = order.find((o) => o.agent)?.key ?? order[0]?.key ?? null;
      this.follow = false;
    }
    const keyboard = this.keys.is_focused();
    const rowList = rowsOf(order);
    const spans = rowSpans(rowList, this.sizes);
    // Heights of rows that are gone would only pile up, and mislead a row that comes back.
    const live = new Set(["#list", ...rowList.flatMap((r) => [r.key, `${r.key}#head`, ...r.kids])]);
    for (const k of this.sizes.keys()) if (!live.has(k)) this.sizes.delete(k);
    const total = this.sizes.get("#list") ?? 0;
    const maxScroll = Math.max(0, total - this.view);
    ({ scroll: this.scroll, follow: this.follow } = scrollStep({ scroll: this.scroll, follow: this.follow, cursor: this.cursor, spans, view: this.view, total, keyboard }));
    const bar = collapsed ? null : thumb(this.view, total, this.scroll);

    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab, paneList)) : a.title || a.program?.name || "";
    };

    // The rail: a number and a status per agent, as in Herdr's list.
    const railRow = (a, i) => h_flex()
      .id(`ag-${a.address}`)
      .on_size_change(this.measure(a.address))
      .h(26)
      .px(8)
      .flex_none()
      .items_center()
      .gap(4)
      .when(keyboard && this.cursor === a.address, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .role("list_box_option")
      .aria_selected(this.cursor === a.address)
      .when(keyboard && this.cursor === a.address, (el) => el.aria_active_descendant())
      .accessibility_label(`${i + 1}, ${label(a) || a.program?.name || a.address}, ${STATUS_WORD[a.status] ?? a.status}. Enter opens its terminal.`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.cursor = a.address; run("pane.focus", { pane: a.pane }); cx.notify(); })
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));

    // The child count, colored by the most urgent child: a child that needs you marks
    // its parent even while the card is collapsed.
    const childBadge = (a, subs) => {
      const top = subs.map((s) => kidStatus(s.t, this.listed)).reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      return h_flex().id(`kids-${a.address}`).h(18).px(4).gap(3).flex_none().items_center().rounded(4).text_size(11)
        .bg(top === "blocked" ? t.blocked + "26" : t.dim + "00")
        .text_color(t[top] ?? t.dim)
        .accessibility_label(`${subs.length} sub-agent${subs.length === 1 ? "" : "s"}${top === "blocked" ? ", one needs you" : ""}`)
        .child(svg("mods/workspace-chrome/branch.svg").size(11).flex_none())
        .child(String(subs.length));
    };

    const card = (a) => {
      const terminal = byAddress.get(a.address);
      const pane = paneList.find((p) => p.pane === a.pane);
      const f = cardFacts(a, terminal, pane, label(a), now);
      const subs = children(all, a.address);
      const open = this.expanded.has(a.address);
      const pic = icon(a.program, 16, t.foreground);
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const current = keyboard && this.cursor === a.address;
      const childCursor = keyboard ? this.cursor : null;
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      // Without a space header above (priority), the card names its space.
      const where = byPriority ? a.space_name : null;
      const alerts = childAlerts(subs, this.listed).map((x) => `${x.name}: ${x.reason}`);
      const task = f.task || f.progress ? [f.progress && `${f.progress.done}/${f.progress.total}`, f.task].filter(Boolean).join(" · ") : null;
      const attention = [f.attention, ...alerts].filter(Boolean);
      const line = attention.length ? attention.join("; ") : task;
      const quick = [f.title, ...(attention.length ? attention : [task]), f.model, f.branch && `Branch ${f.branch}`].filter(Boolean).join("\n");
      const disclose = `${open ? "Hide" : "Show"} details for ${f.title}`;
      const pad = pic ? 24 : 0;
      // Spacing lives inside the measured wrapper, so heights stack (see rowSpans).
      return div().id(`wrap-${a.address}`).py(CARD_GAP).flex_none().on_size_change(this.measure(a.address)).child(v_flex()
        .id(`ag-${a.address}`)
        .px(10)
        .py(CARD_PAD)
        .rounded(9)
        .border(CARD_BORDER)
        .border_color(current ? t.accent : a.status === "blocked" ? t.blocked + "66" : t.border)
        .bg(a.focused ? t.selected : t.raised)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(quick)
        .role("list_box_option")
        .aria_selected(this.cursor === a.address)
        .when(current, (el) => el.aria_active_descendant())
        .accessibility_label(`${f.title}, ${STATUS_WORD[a.status] ?? a.status}${line ? `, ${line}` : ""}. Enter opens its terminal; Space shows details.`)
        // A press on a card opens its terminal; it doesn't give the list the keyboard.
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => { this.cursor = a.address; run("pane.focus", { pane: a.pane }); })
        .child(v_flex().id(`head-${a.address}`).gap(3).on_size_change(this.measure(`${a.address}#head`))
        .child(h_flex().gap(8).items_center()
          .when(Boolean(pic), el => el.child(pic))
          .child(h_flex().flex_1().min_w(0).gap(5).items_center()
            .child(div().min_w(0).truncate().font_medium().text_color(idle ? t.muted : t.foreground).child(f.title))
            .when(Boolean(where), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`· ${where}`))))
          .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
          .when(subs.length > 0, el => el.child(childBadge(a, subs)))
          .when(Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
          .child(this.status(t, a, byPriority))
          .child(div().id(`disclose-${a.address}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
            .text_color(t.dim)
            .role("button")
            .accessibility_label(disclose)
            .tooltip(disclose)
            .hover((s) => s.bg(t.input).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.cursor = a.address; this.toggle(a.address); cx.notify(); })
            .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12))))
        .children(attention.map((text, i) => div().id(`reason-${a.address}-${i}`).pl(pad).text_size(11.5).whitespace_normal().text_color(t.blocked).child(text)))
        .when(!attention.length && Boolean(task), el => el.child(div().id(`task-${a.address}`).pl(pad).text_size(11.5).truncate().text_color(t.muted).child(task)))
        .when(open, el => el.child(this.details(t, a, f, subs))))
        .when(open, el => el.children(subs.map((s) => this.subRow(t, s, a.address, shown, childCursor === `${a.address}>${s.t.address}`)))));
    };

    // Up/Down move between cards and the child rows of expanded ones. Enter opens a card's
    // terminal or peeks at a child; Space or Right/Left show or hide a card's details.
    const onKey = (e, cx) => {
      const i = order.findIndex((o) => o.key === this.cursor);
      const it = order[i];
      const page = pageScroll(e.key, this.scroll, this.view, total);
      if (page !== null) {
        // Reading by the page is deliberate scrolling, like the wheel: it stops following.
        this.scroll = page;
        this.follow = false;
        cx.stop_propagation();
        return cx.notify();
      }
      if (e.key === "escape") {
        // Back to the agent on screen, as the keyboard came from it.
        const back = list.find((a) => a.focused);
        if (!back) return; // nothing to return to: Herdr handles Escape
        run("pane.focus", { pane: back.pane });
        return cx.stop_propagation();
      }
      if (e.key === "down" || e.key === "up") {
        const next = order[Math.min(order.length - 1, Math.max(0, i + (e.key === "down" ? 1 : -1)))];
        this.cursor = next?.key ?? null;
      } else if (!it) return;
      else if (it.expand) {
        if (e.key !== "enter" && e.key !== "space") return;
        toggleSidebar();
      }
      else if (collapsed && e.key !== "enter") return;
      else if (it.sort) {
        if (e.key !== "enter" && e.key !== "space") return;
        openSort();
      }
      else if (it.group) {
        const open = !this.folded.has(it.group.id);
        if (e.key === "enter" || e.key === "space" || (e.key === "left" && open) || (e.key === "right" && !open)) {
          open ? this.folded.add(it.group.id) : this.folded.delete(it.group.id);
        } else return;
      }
      else if (e.key === "enter") it.agent ? run("pane.focus", { pane: it.agent.pane }) : run("terminal.peek", { terminal: it.terminal });
      else if (!it.agent) return;
      else if (e.key === "space") this.toggle(it.agent.address);
      else if (e.key === "right" || e.key === "left") this.toggle(it.agent.address, e.key === "right");
      else return;
      this.follow = true;
      cx.stop_propagation();
      cx.notify();
    };

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      // Folded, it shows its most urgent member, counting what lifts a parent (its children).
      const top = SECTION_STATUS[Math.max(0, ...g.members.map(rankOf))] ?? null;
      const current = keyboard && this.cursor === g.id;
      return h_flex()
        .id(g.id)
        .on_size_change(this.measure(g.id))
        .px(4)
        .pt(8)
        .h(30)
        .flex_none()
        .rounded(6)
        .when(current, (el) => el.bg(t.selected))
        .aria_selected(this.cursor === g.id)
        .when(current, (el) => el.aria_active_descendant())
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .role("button")
        .accessibility_label(`${g.label}, ${g.members.length}, ${open ? "open; Enter folds it" : "folded; Enter opens it"}`)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          this.cursor = g.id;
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const openSort = () => openOverlay({ mod: "agents-enriched", kind: "popup", width: 200, height: 140, props: { sortMenu: true } });
    const rows = collapsed
      ? list.map(railRow)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.map(card))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .p(2)
                .rounded(4)
                .text_size(11)
                .text_color(t.dim)
                .role("button")
                .accessibility_label(`Sort agents: ${sort.label}`)
                .border(1)
                .border_color(keyboard && this.cursor === "#sort" ? t.accent : t.chrome)
                .hover((s) => s.text_color(t.foreground))
                .on_click(openSort)
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      // The cards and the rail share one self-scrolling list, so both keep the selection in view.
      .child(div().id("ag-list").flex_1().min_h(0).relative().overflow_hidden()
        .track_focus(this.keys).tab_index(0).role("list_box").accessibility_label("Agents").on_key_down(onKey)
        // A press between cards gives the list the keyboard; cards and headers stop their own presses.
        .on_mouse_down("left", () => this.keys.focus())
        .on_size_change((size, cx) => { if (this.view !== size.height) { this.view = size.height; cx.notify(); } })
        .on_scroll_wheel((e, cx) => {
          this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
          this.follow = false;
          cx.notify();
        })
        // Dragging the thumb; it ends on release, or when the pointer leaves the list.
        .on_mouse_move((e, cx) => {
          if (!this.drag) return;
          this.scroll = dragScroll(this.drag, e.position.y, this.view, total);
          this.follow = false;
          cx.notify();
        })
        .on_mouse_up("left", () => { this.drag = null; })
        .on_hover((on) => { if (!on) this.drag = null; })
        .child(v_flex().id("ag-rows").absolute().left(0).right(0).top(-this.scroll).px(collapsed ? 0 : 8).pb(collapsed ? 0 : 8)
          .on_size_change(this.measure("#list"))
          .children(rows))
        .when(Boolean(bar), (el) => el.child(div().id("ag-thumb").absolute().right(1).w(6).rounded(3).bg(t.dim + "66")
          .top(bar.top).h(bar.h)
          .hover((s) => s.bg(t.dim))
          .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.drag = { y: e.position.y, scroll: this.scroll }; }))))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .px(6)
                .rounded(4)
                .text_size(13)
                .text_color(t.dim)
                .role("button")
                .accessibility_label("Show the full sidebar")
                .when(keyboard && this.cursor === "#expand", (el) => el.bg(t.selected).text_color(t.foreground))
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
