// Go to a tab. Drops from the Terminals layout's space chip (popup, at: "top"). Spaces with
// something that needs you come first, quiet spaces (no agent running)
// fold into "earlier". Filter by state, / to search, ↑/↓ or Tab/Shift+Tab
// and Enter to go, ctrl+d to close a tab. Esc leaves search before closing.
// Last rows: new work (a tab here, a space on this computer or a connected machine).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, panes, terminals, run, hc, theme, settings, props, closeOverlay, openOverlay, shared, setShared, nextCommand } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Space colors, kept by space id in shared "space.colors": a theme
// color name ("ansi6") or a picked #rrggbb. A space seen without one gets
// the theme color fewest spaces use, once; every mod does the same in the
// same order, so they agree, and adding or renaming spaces moves nothing.
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

export default class Picker extends View {
  init(_props, cx) {
    this.filter = ""; this.stateFilter = "all"; this.searching = false;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search tabs, spaces or agents…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows().filter(r => r.kind === "ctx" || r.kind === "new" || r.kind === "space")[this.at]));
    this.handle.focus();
    this.at = null;
    this.scroll = 0;
    this.showEarlier = false;
    this.showPanes = false;
    this.machines = [];
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command !== "next" && command !== "previous") continue;
        const count = this.rows().filter(r => r.kind === "ctx" || r.kind === "new" || r.kind === "space").length;
        this.move(command === "next" ? 1 : -1, count);
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  move(delta, count) {
    this.at = (this.at + delta + count) % count;
  }

  rows() {
    const f = this.filter.toLowerCase();
    const all = agents();
    const paneList = panes();
    const terminalMap = new Map(terminals().map(t => [t.address, t]));
    const live = terminals().filter((x) => x.state === "live");
    const teamOf = (addrs) => {
      let n = 0;
      const walk = (a) => live.filter((x) => x.parent === a).forEach((k) => (n++, walk(k.address)));
      addrs.forEach(walk);
      return n;
    };
    const groups = spaces().map((w) => {
      const ctxs = w.tabs
        .map((ctx) => {
          const mine = all.filter((a) => a.tab === ctx.id);
          return { w, ctx, mine, display: tabTitle(ctx, paneList, terminalMap), team: teamOf(mine.map((a) => a.address)) };
        })
        .filter(c => matchesState(c.mine, this.stateFilter))
    .filter((c) => !f || [w.name, c.ctx.name, c.display.full, ...c.mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase().includes(f));
      return { w, ctxs };
    });
    const busy = groups.filter((p) => p.w.status && p.ctxs.length);
    const quiet = groups.filter((p) => !p.w.status && p.ctxs.length);
    busy.sort((a, b) => (b.w.status === "blocked") - (a.w.status === "blocked"));
    const out = [];
    const add = (p) => {
      out.push({ kind: "head", w: p.w });
      for (const c of p.ctxs) {
        out.push({ kind: "ctx", ...c });
        if (this.showPanes) {
          for (const pane of paneList.filter((pane) => pane.tab === c.ctx.id)) {
            const mine = c.mine.filter((a) => a.pane === pane.pane);
            const full = paneTitle(pane, terminalMap);
            out.push({ kind: "ctx", ...c, pane, mine, display: { full, text: full }, team: teamOf(mine.map((a) => a.address)) });
          }
        }
      }
    };
    busy.forEach(add);
    if (quiet.length) {
      out.push({ kind: "earlier", count: quiet.length });
      if (this.showEarlier || f || this.stateFilter !== "all") quiet.forEach(add);
    }
    out.push({ kind: "new" });
    out.push({ kind: "space", machine: null });
    for (const m of this.machines) out.push({ kind: "space", machine: m });
    return out;
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.pane) run("pane.focus", { pane: r.pane.pane });
    else if (r.kind === "ctx") run("tab.select", { id: r.ctx.id });
    else if (r.kind === "new") run("tab.new");
    else if (r.kind === "space") run("space.new", r.machine ? { machine: r.machine } : {});
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const pickable = rows.filter((r) => r.kind === "ctx" || r.kind === "new" || r.kind === "space");
    // Opens on where you are.
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((r) => r.kind === "ctx" && r.w.active && r.ctx.active));
    this.at = Math.min(this.at, pickable.length - 1);
    const sel = pickable[this.at];
    // One continuous strip: each row (and the group title before it) at a fixed
    // y. Scrolling moves the strip only as far as it takes to keep the selected
    // row in view, so the arrows can't run the selection off the list.
    const H = { head: 29, earlier: 35, new: 36, ctx: 32, space: 32 };
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind] ?? 32; });
    const total = y;
    const height = Math.min(320, this.listHeight ?? 320);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    const hi = sel?.kind === "ctx" ? rows.findIndex((r) => r.kind === "head" && r.w.id === sel.w.id) : -1;
    if (si >= 0) {
      // Leave room for the selected tab's workspace title when its group scrolls out of view.
      const top = hi < 0 ? tops[si] : Math.max(tops[hi], tops[si] - H.head);
      if (top < this.scroll) this.scroll = top;
      if (tops[si] + (H[sel.kind] ?? 32) > this.scroll + height) this.scroll = tops[si] + (H[sel.kind] ?? 32) - height;
    }
    const sticky = hi >= 0 && tops[hi] < this.scroll;
    const place = (el, i) =>
      fixed
        ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + (H[rows[i].kind] ?? 32) - this.scroll))
        : el;
    const visible = (i) => (!sticky || i !== hi) && (!fixed || (tops[i] + (H[rows[i].kind] ?? 32) > this.scroll && tops[i] < this.scroll + height));

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex()
          .px(10)
          .pt(10)
          .pb(3)
          .gap(8)
          .items_center()
          .text_size(11)
          .font_semibold()
          .text_color(t.dim)
          .child(h_flex().size(18).rounded(5).bg(spaceColor(t, r.w)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.w.name][0]?.toUpperCase() ?? "?"))
          .child(r.w.name);
      }
      if (r.kind === "earlier") {
        return h_flex()
          .id("pk-earlier")
          .mt(6)
          .px(10)
          .py(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.showEarlier = !this.showEarlier;
            cx.notify();
          })
          .child(`earlier: ${r.count} quiet space${r.count > 1 ? "s" : ""} ${this.showEarlier ? "▴" : "▾"}`);
      }
      const on = r === sel;
      if (r.kind === "new" || r.kind === "space") {
        const label = r.kind === "new" ? "new tab" : r.machine ? `new space on ${r.machine}` : "new space";
        return h_flex()
          .id(r.kind === "new" ? "pk-new" : `pk-space-${r.machine ?? "here"}`)
          .mx(4)
          .when(r.kind === "new", (el) => el.mt(4))
          .px(10)
          .h(32)
          .items_center()
          .rounded(7)
          .gap(8)
          .text_color(t.muted)
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r))
          .child(div().w(12).child("+"))
          .child(label);
      }
      const who = r.mine.map((a) => a.program?.name ?? "agent").join(" · ");
      const here = r.w.active && r.ctx.active && (!r.pane || r.pane.focused);
      const status = r.pane ? r.mine[0]?.status : r.ctx.status;
      return h_flex()
        .id(r.pane ? `pk-pane-${r.pane.pane}` : `pk-${r.ctx.id}`)
        .mx(4)
        .px(10)
        .when(Boolean(r.pane), (el) => el.pl(30))
.h(32)
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(this.glyph(t, status))
        .child(div().flex_1().truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).tooltip(r.display.full).child(r.display.text))
        .when(status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .child(div().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : "")));
    };

    return v_flex()
      .id("picker")
      .track_focus(this.handle)
      // Keep picker bindings inside the native Root's Tab focus-traversal context.
      .key_context("Mod mod = picker-enriched")
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") {
          if (this.searching) {
            this.searching = false;
            this.filter = "";
            this.input.set_value("");
            this.handle.focus();
          } else this.close();
        } else if (k === "down") this.move(1, pickable.length);
        else if (k === "up") this.move(-1, pickable.length);
        else if (k === "enter" && !this.searching) this.go(sel);
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "ctx") {
            this.close();
            run("tab.close", { id: sel.ctx.id });
          }
        } else if (!this.searching && !e.modifiers.control && !e.modifiers.alt && !e.modifiers.platform) {
          if (k === "/") {
            this.searching = true;
            this.input.focus();
          } else if (k === "p" || k === "P") {
            this.showPanes = !this.showPanes;
            this.at = this.rows().filter(r => r.kind === "ctx" || r.kind === "new" || r.kind === "space")
              .findIndex(r => r.kind === sel.kind && r.ctx?.id === sel.ctx?.id && r.machine === sel.machine && !r.pane);
          } else if (k === "h" || k === "l") {
            const starts = [];
            for (let i = 0; i < pickable.length; i++) {
              if (pickable[i].kind === "ctx" && pickable[i].w.id !== pickable[i - 1]?.w?.id) starts.push(i);
            }
            const current = starts.findIndex((i) => pickable[i].w.id === sel.w?.id);
            if (starts.length && (starts.length > 1 || current < 0)) {
              const next = current < 0 ? (k === "l" ? 0 : starts.length - 1)
                : (current + (k === "l" ? 1 : -1) + starts.length) % starts.length;
              this.at = starts[next];
            }
          } else if (k === "k") this.move(-1, pickable.length);
          else if (k === "j") this.move(1, pickable.length);
          else {
            const state = stateFilters.find((s) => s[2] === k);
            if (!state) return;
            this.stateFilter = state[0]; this.at = 0; this.scroll = 0;
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(filterChips(this, t))
    .when(this.stateFilter !== "all" && !rows.some(r => r.kind === "ctx"),
      el => el.child(div().text_color(t.muted).text_size(12).child("No agents match this filter")))
    .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…"))
      .child(div().text_size(11).text_color(t.dim).child(this.searching ? "Esc: filters" : `P: panes ${this.showPanes ? "on" : "off"} · /: search · Esc: close`)))
      .when(this.searching, el => el.child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      ))
      .child(
        v_flex()
          .id("pk-list")
          .on_size_change((size, cx) => {
            this.listHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(Math.min(320, total))
          .min_h(0)
          .mb(6)
          .when(fixed, (el) =>
            el.overflow_hidden().on_scroll_wheel((e, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
              // The selection follows the wheel, so the next frame doesn't scroll back to it.
              while (this.at < pickable.length - 1 && tops[rows.indexOf(pickable[this.at])] < this.scroll) this.at++;
              while (this.at > 0 && tops[rows.indexOf(pickable[this.at])] + (H[pickable[this.at].kind] ?? 32) > this.scroll + height) this.at--;
              cx.notify();
            }))
          .children(rows.map((r, i) => (visible(i) ? place(row(r), i) : null)).filter(Boolean))
          .when(sticky, (el) => el.child(
            row(rows[hi]).absolute().left(0).right(0).top(0).h(H.head).bg(t.popover),
          )),
      );
  }
}



// Labels survive Core recovery; only a live reporter's lease may reach the UI.
function activity(terminal, now = Date.now()) {
  if (terminal?.state !== "live") return null;
  try {
    const data = JSON.parse(terminal.labels?.["nix.activity"] ?? "null");
    if (data?.version !== 1 || !Number.isFinite(data.expires) || data.expires <= now) return null;
    if (terminal.program?.key !== data.agent) return null;
    const tokens = data.tokens;
    if (!tokens || ["agent", "title", "todo", "sub1", "sub2", "sub3", "submore"].some(k => typeof tokens[k] !== "string" || [...tokens[k]].length > 80)) return null;
    return tokens;
  } catch {
    return null;
  }
}

function paneTitle(p, terminalMap) {
  const program = p.program?.name || p.mod || 'Terminal';
  const terminal = terminalMap.get(p.terminal);
  const title = p.program?.agent ? (activity(terminal)?.title || terminal?.report?.title || p.title || '').replace(/\s+/g, ' ').trim() : '';
  return title && title !== program ? `${program} · ${title}` : program;
}

function tabTitle(tab, paneList, terminalMap) {
  const members = paneList.filter(p => p.tab === tab.id);
  // terminal.open stores its launch program as a name even without an explicit rename.
  const launchName = tab.name === 'shell' || members.some(p => [p.program?.key, p.program?.name].includes(tab.name));
  const full = tab.named && !launchName ? tab.name : members.map(p => paneTitle(p, terminalMap)).join(' | ') || tab.name;
  const characters = Array.from(full);
  return { full, text: characters.length > 80 ? `${characters.slice(0, 79).join('')}…` : full };
}
const stateFilters = [
  ['all', 'All', 'a'], ['working', 'Working', 'w'], ['blocked', 'Needs you', 'b'], ['done', 'Done', 'd'], ['idle', 'Idle', 'i'],
];

function matchesState(agents, state) {
  return state === 'all' || agents.some(agent => agent.status === state);
}

function filterChips(picker, t) {
  return h_flex().gap(6).flex_none().children(stateFilters.map(([state, label, key]) =>
    div().id(`pk-state-${state}`).px(8).py(5).rounded(6).cursor_pointer()
      .bg(picker.stateFilter === state ? t.selected : t.background)
      .text_color(picker.stateFilter === state ? t.foreground : t.muted)
      .text_size(11).tooltip(picker.searching ? label : `${key}: ${label}`)
      .on_click((_event, cx) => {
        picker.stateFilter = state;
        picker.at = 0;
        picker.scroll = 0;
        if (picker.searching) picker.input.focus();
        else picker.handle.focus();
        cx.notify();
      }).child(picker.searching ? label : `${key} ${label}`)
  ));
}