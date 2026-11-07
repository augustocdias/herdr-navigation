# Navigation

Build a Herdr workspace layout with a familiar sidebar, a tab bar that describes every pane, and a picker that can narrow results by agent state without losing keyboard focus in search.

## Layout

Use Herdr's main layout structure: spaces and agents in a sidebar, tabs above the work area, and the existing Files and Changes panels. Keep the standard window controls and terminal panes. Replace the tab-bar mod with `tabs-enriched`, the spaces sidebar with `spaces-enriched`, and the agents list with `agents-enriched`; keep the other shipped mods.

The supplied layout is optional. The mods can be used in an existing layout without adopting this arrangement.

## Smart Tabs

For every pane in a tab, show the program name. For an agent, append its available session title with a middle dot. Join pane labels with ` | ` in pane order. Avoid folder and branch labels. Keep descriptive manual tab names, but treat `shell` and current program-name launch defaults as automatic.

Limit the label to 80 Unicode code points, including an ellipsis when needed, and 480 pixels. Expose the full label in a tooltip. Keep the tab's icon, status indicator, close control, drag-to-reorder behavior, double-click rename, and scroll navigation. Title calculation must not mutate saved names.

Prefer a live optional integration title, then the native agent report title, then the terminal title. Missing metadata must fall back to the program name, not fabricated session content. Treat all titles as display text.

## Agent Picker

Merge the repository's `keys.json` fragment into the existing key configuration. It binds Alt+W to `mod.open:picker-enriched`, Alt+A to `agents-enriched.focus`, and disables the global Ctrl+1–5 actions inside that mod so its own filter handler receives them. Show the same tab labels and allow text search across the full, untruncated label.

Provide clickable All, Working, Needs you, Done, and Idle chips. Ctrl+1 through Ctrl+5 select them while the search input remains focused. Reset row selection and scroll position after a filter change. Combine state and text predicates. Match any agent in a tab rather than only its aggregate state; shell-only tabs do not match agent-state filters.

Preserve arrow-key navigation, Enter, Escape, Ctrl+D to close a tab, and new-tab/new-space actions. Show an explicit empty-result message when a state filter and search have no matches. Follow Herdr's native attention semantics, including Done becoming Idle when viewed.

## Agent Cards

Show each agent as a card with its harness icon, session title and status. Under the title, show a blocked agent's whole reason, wrapped; use its blocked report message, else its kind, else "Needs attention". A parent lifted into Needs you by a blocked child terminal shows that child's reason the same way. Otherwise show the active task and checklist count when the optional integration reports them.

A chevron button toggles details: task, model, workspace, branch, Core child terminals and reported sub-agents. Cards start collapsed, keep the person's choice while the agent is listed, and never open or close on a status change. A card click focuses the terminal; the chevron only toggles. Peek only at child terminals Core lists; reported sub-agents are text. Keep permission prompts in terminals.

Keep Herdr's Priority and Grouped by space views, its ordering and Done/Idle semantics, and `agent.next`/`agent.prev` order. Drop agent pins. Hover tooltips repeat what the card and its details show. Up, Down, Enter, Space, Right and Left operate the focused list, including group headers, and the list keeps the selection visible as rows change. Page Up, Page Down, Home and End scroll the list, so oversized reasons read to the end. The sort button, its menu, the narrow rail and its expand control work from the keyboard; Escape returns to the terminal. Fall back to native data when the integration's label is missing, expired, malformed or from another program.

## Space Shortcuts

Add Open workspace and New worktree buttons before the local `+` in the spaces sidebar: on the This computer row when another machine is known, else in the Spaces header. Hide them in the narrow rail. Both act on this computer only.

Open workspace takes a folder from the system picker, selects a local space made in that folder, or opens one named after the folder (`repo/branch` for a main checkout kept as `<repo>/<branch>`). New worktree asks for a branch of the active space's repository, reuses its worktree or checks it out at `<repo folder>/<branch>` from the existing branch or HEAD, and names the space after the branch. Ask before running `direnv allow` on the folder's own `.envrc`, with Allow & open, Open only, and Cancel.

## Appearance and installation

Use the active Herdr theme for all added controls. Keep each mod self-contained so they work through Home Manager file symlinks. The repository's Home Manager module installs only the mods; declare keys and layout selection separately in Nix and rebuild before treating the change as installed.

The preview comes from an isolated App/Core session with synthetic status reports. Preserve the Apache-2.0 attribution when distributing derived code.
