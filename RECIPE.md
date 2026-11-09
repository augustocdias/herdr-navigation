# Navigation

Build a Herdr workspace with a spaces sidebar, expandable agent cards, descriptive tabs, and a searchable tab picker with agent-state filters. Keep terminals and the standard Files and Changes panels. Each replacement mod must also work in an existing layout.

![Navigation](preview.png)

## What you see

The left sidebar is 268 pixels wide, with a 46-pixel window-control header, spaces above agents in equally weighted regions with 90-pixel minimum heights, and a 69-pixel footer. A narrow rail replaces the lists when collapsed. Spaces have stable colored avatars; worktree spaces sit under their main checkout. Open workspace and New worktree buttons appear before the local plus button, but disappear in the rail.

The work area has a 42-pixel tab bar, terminal panes in the middle, and a 28-pixel status bar below. The pane area has 8-pixel padding and gaps. Panes have 10-pixel corners, 1-pixel borders and 30-pixel headers. A hidden right panel starts at 368 pixels wide and can range from 280 to 900 pixels.

Tabs describe every pane in pane order. Each label shows its program and, for agents, the available session title separated by a middle dot. Multiple panes use ` | ` between labels. Descriptive manual names take precedence. Labels stop at 80 Unicode code points, including an ellipsis, and 480 pixels; tooltips show the full label. Pinned mod tabs sit first, in configured order, with icons only and a divider before ordinary tabs.

Agent cards show a harness icon, title, status and elapsed time. Blocked cards show their whole attention reason, wrapped. Other cards show available task progress. A chevron reveals the full title, task counts, active tasks, model, workspace, branch, child terminals and reported sub-agents. Missing details explicitly say they were not reported. Use the active theme's chrome, foreground, dim, accent and status colors, rather than a fixed palette.

## How it behaves

Working agents use the theme's working color; the picker uses a spinning indicator. Blocked agents appear as Needs you in the blocked color, with their report message, then report kind, then "Needs attention" as the reason. Done uses the done color and follows Herdr's viewed-agent attention behavior. Idle uses the idle color and a hollow circle in the picker. A blocked child terminal can lift its parent into Needs you and supply the displayed reason.

Click a tab to select it, drag ordinary tabs to reorder them, double-click an ordinary tab to rename it, and scroll to navigate tabs. Title updates never rewrite saved names. Treat saved names equal to shell or a current launch program as automatic names. Right-click opens the tab menu. Mod-pane tabs can be pinned across spaces; terminal tabs cannot. Pinned tabs cannot be renamed or closed from their menu. Unpin keeps existing copies open as ordinary tabs. A pinned tab closed by another command reopens.

Alt+W opens the picker. Search full titles, saved names, space names and program names. All, Working, Needs you, Done and Idle chips combine with the text query. Ctrl+1 through Ctrl+5 select those filters without moving focus out of search. A state filter matches any agent in the tab; shell-only tabs match only All. Reset selection and scroll after a filter change. Keep arrow navigation, Enter to open, Escape to dismiss, Ctrl+D to close the selected tab, and new-tab and new-space actions. Show an explicit message when no results match.

Click an agent card to focus its terminal. Its chevron only toggles details. Cards start collapsed, retain the person's choice while listed, and never expand or collapse because their status changes. Child terminals can be peeked; reported sub-agents without Core terminals are text only. Keep permission prompts in terminals. Hover tooltips repeat the card's available details, wrapping lines at 64 characters.

Alt+A focuses the agents list. Up and Down traverse the sort button, group headers, cards and expanded child terminals. Enter focuses a terminal; Space toggles card details; Right expands and Left collapses. Enter or Space toggles group headers and operates the sort menu. Page Up, Page Down, Home and End scroll, including reasons taller than the list. Keep keyboard selection visible until the person scrolls. Escape returns to the terminal. The narrow rail supports agent selection and keyboard access to its expand control. Preserve Priority and Grouped by space views and native attention ordering. Do not provide agent pins.

Open workspace uses the system folder picker and selects an existing local space for the folder or opens a new one. Name a main checkout stored as repo/branch after both parts. New worktree asks for a branch in the active local space's repository. Reuse a registered checkout, preserve an existing branch, or create a branch from HEAD. Name its space after the branch. Before trusting a folder's own unapproved environment file, offer Allow & open, Open only and Cancel. These shortcuts operate only on this computer.

## Built from

Use this layout tree:

```text
root: row, canvas background, 1px border-colored dividers
  sidebar: column, 268px, min 44px, max 480px, chrome background
    brand: 46px block, workspace-chrome, window drag
    sidebar-lists: column
      spaces: weight 1, min 90px, spaces-enriched
      agents: weight 1, min 90px, agents-enriched
    sidebar-footer: 69px block, workspace-chrome, props { footer: true }
  work: column
    tabs: 42px block, tabs-enriched, window drag
    work-body: row, padding 8px, gap 8px
      main: active tab, pane headers supplied by pane
      panel: hidden column, 368px, min 280px, max 900px
        panel-body: stack, initially files
          files: files mod
          changes: changes mod
    status: 28px block, workspace-status
```

Set terminal padding to `[14, 12]` and traffic-light coordinates to `[12, 16]`. Keep the shipped `workspace-chrome`, `workspace-status`, `pane`, `files`, `changes`, `menu` and supporting overlays and artwork. Reuse their icons and program icons; the screenshot is illustrative, not a runtime asset.

Supply five self-contained JavaScript mods using `gpui-kit`, `gpui-base` and `herdr`:

- `tabs-enriched` reads spaces, panes, terminals, theme, keys, settings, layout and machines. It runs tab selection, rename, close, move and creation commands and layout panel commands. It uses shared state, overlays, application-home paths, text-file reads, notifications and subprocess execution for provider icon checks. The same mod renders its tab menu when passed menu items in props.
- `picker-enriched` reads spaces, panes, terminals and agents, uses Core data through `hc`, and manages a focused search input. It selects or closes tabs and creates tabs or spaces. Overlay props identify the overlay to dismiss.
- `agents-enriched` reads agents, terminals, panes, spaces, focus and layout. It uses `setAgentOrder` for native next/previous navigation, `nextCommand` for keyboard focus commands, overlays for menus and peeks, shared state for sidebar width, and layout resize commands for the rail.
- `spaces-enriched` reads local and remote spaces, machines and panes, watches repository folders, queries Git through `exec`, and uses `hc` for remote data. It selects, moves and creates spaces and opens `space-open` as a 460-by-240-pixel dialog.
- `space-open` receives `action: "worktree"` and the active folder for worktree creation; without that action it opens the folder picker. It uses `pickFolder`, `exec`, spaces, theme and overlay props. It runs `git`, `realpath`, `test` and optional `direnv`. Worktree creation uses `git worktree add`; trust approval uses `direnv allow`. It selects, renames or creates a local space.

Read optional `nix.activity` labels only as supplementary display data. Prefer a valid integration title, then the native agent report title, then the terminal title or program name. Validate detail fields independently; reject stale, malformed or wrong-program labels. Never treat a reported sub-agent id as a Core terminal address.

Read configured pins from `mods/tabs-enriched/pinned.json` as a list of `{ "label": "Board", "mod": "my-board" }`. Persist menu additions and removals in shared state under `tabs-enriched.pins`, without writing the configuration file. Open missing pins when a space is shown, restore the previously selected tab, and keep pins first. Match pins by both name and mod pane. A provider may publish controls through `tab-controls:<mod>` using entries with required `label` and `command`, plus optional `id`, `icon`, `args` and `active`. Show them only while a tab contains that provider and dispatch their command on click.

Merge the repository's key fragment into existing keys. Bind Alt+W to `mod.open:picker-enriched` and Alt+A to `agents-enriched.focus`. In the picker-specific section, map Ctrl+1 through Ctrl+5 to `terminal` so global tab shortcuts do not consume the filter keys. Ask before replacing an existing conflicting binding.

The Home Manager module installs the five mods and optional pin configuration only. Declare key merging and layout installation separately. The complete layout is optional; existing layouts can replace only their tabs, spaces and agents mod identifiers.

## Watch out

These mods run programs and inspect files outside their own folders. Space shortcuts can create Git worktrees and authorize environment files after approval. Repository status checks include remote repositories when configured. Tell the person before installation; do not describe this as a display-only mod.

Keep each mod in one JavaScript file so Home Manager store symlinks do not break relative imports. Maintain the same title logic in tabs and picker. Missing integration data must fall back to native data, not invented session content. Core retains its last accepted report, so an attention reason is not proof of a fresh report from the current session.

Provider tab artwork uses `tab-icon.svg` in full color, then `icon.svg` tinted, then the pin glyph. Herdr does not draw symlinked SVG icons reliably; providers installed through Home Manager may need to write regular icon files themselves. Retry icon discovery every two seconds during rendering until a full-color icon is found. Use the shell's `test` builtin for the full-color icon symlink check.

An absent pin file must not erase remembered unpins. A loaded configuration that no longer contains an entry can clear that entry's removal. Renaming a pin externally makes it an ordinary tab and causes a replacement to open. A missing provider logs an error and is retried for that space only after the mod reloads. A space with a pinned tab remains open after its last ordinary tab closes.

Never overwrite existing mod or layout names during manual installation. If renaming, update layout references, internal asset paths and key bindings together. Preserve the Apache-2.0 license and attribution. The preview uses synthetic agent reports. The README records previous Linux checks with App 0.1.11 and Core 0.1.16; it does not claim Windows or macOS verification.

## Done when

- Each of the five mods passes `herdr-app check` in an isolated App home and Core session, including installation through Nix-store symlinks.
- The optional layout loads with its sidebar, tabs, terminals, Files and Changes panels, and status bar. The person's original layout remains available.
- A split tab shows every pane in order. Long Unicode labels truncate correctly, tooltips remain complete, and descriptive saved names survive redraws.
- The picker combines text and all five state filters, keeps search focused, handles mixed-state tabs, and preserves navigation and empty-result actions.
- Cards display Working, Needs you, Done and Idle, full blocked reasons and child reasons. Native-only data works. Invalid or expired integration labels do not retain old details.
- Card disclosure stays unchanged through status updates. Keyboard navigation reaches menus, headers, cards, child terminals and the rail's expand control. A reason taller than the list can be read to its end.
- Configured and menu pins open in each visited space, remain first, preserve the selected tab and persist across reloads. Unpin leaves ordinary tabs open. Provider icons and controls appear on the matching mod tab.
- Open workspace reuses an existing space. New worktree reuses an existing checkout or creates the requested branch without resetting an existing branch. Cancel creates no space, and Open only does not authorize the environment file.
- Run `node --test` for the existing naming, worktree, direnv, pin and agent-card checks. Exercise the visible interactions in an isolated session and inspect status and a screenshot; loader checks alone are insufficient.

This recipe follows the installed Herdr App guide, "Layouts and mods other people made", and the layout, mods, key fragment and Home Manager module in this repository. Herdr's public catalogs are [layouts](https://herdr.dev/layouts) and [mods](https://herdr.dev/mods).
