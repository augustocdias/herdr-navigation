# Navigation

Build a Herdr workspace layout with a familiar sidebar, a tab bar that describes every pane, and a picker that can narrow results by agent state without losing keyboard focus in search.

## Layout

Use Herdr's main layout structure: spaces and agents in a sidebar, tabs above the work area, and the existing Files and Changes panels. Keep the standard window controls and terminal panes. Replace the tab-bar mod with `tabs-enriched`; keep the other shipped mods.

The supplied layout is optional. Both mods can be used in an existing layout without adopting this arrangement.

## Smart Tabs

For every pane in a tab, show the program name. For an agent, append its available session title with a middle dot. Join pane labels with ` | ` in pane order. Avoid folder and branch labels. Keep descriptive manual tab names, but treat `shell` and current program-name launch defaults as automatic.

Limit the label to 80 Unicode code points, including an ellipsis when needed, and 480 pixels. Expose the full label in a tooltip. Keep the tab's icon, status indicator, close control, drag-to-reorder behavior, double-click rename, and scroll navigation. Title calculation must not mutate saved names.

Prefer a live optional integration title, then the native agent report title, then the terminal title. Missing metadata must fall back to the program name, not fabricated session content. Treat all titles as display text.

## Agent Picker

Bind Alt+W to `mod.open:picker-enriched`. Show the same tab labels and allow text search across the full, untruncated label.

Provide clickable All, Working, Needs you, Done, and Idle chips. Ctrl+1 through Ctrl+5 select them while the search input remains focused. Reset row selection and scroll position after a filter change. Combine state and text predicates. Match any agent in a tab rather than only its aggregate state; shell-only tabs do not match agent-state filters.

Preserve arrow-key navigation, Enter, Escape, Ctrl+D to close a tab, and new-tab/new-space actions. Show an explicit empty-result message when a state filter and search have no matches. Follow Herdr's native attention semantics, including Done becoming Idle when viewed.

## Appearance and installation

Use the active Herdr theme for all added controls. Keep both mods self-contained so they work through Home Manager file symlinks. The repository's Home Manager module installs only the mods; declare keys and layout selection separately in Nix and rebuild before treating the change as installed.

The preview comes from an isolated App/Core session with synthetic status reports. Preserve the Apache-2.0 attribution when distributing derived code.
