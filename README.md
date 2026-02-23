<p align="center">
  <img src="assets/logo.png" alt="cladm" width="280" />
</p>

<h3 align="center">TUI launcher for Claude Code sessions</h3>

<p align="center">
  Browse all your projects, see git status at a glance, expand into sessions and branches, then launch everything in parallel Terminal windows.
</p>

---

<p align="center">
  <img src="assets/demo.gif" alt="cladm demo" width="900" />
</p>

## Install

Requires [Bun](https://bun.sh) >= 1.3.0 and macOS (uses Terminal.app for launching).

```bash
# Clone and install
git clone https://github.com/alezmad/cladm.git
cd cladm
bun install

# Register the `cladm` command globally
bun link
```

Now you can run `cladm` from anywhere.

## Usage

```bash
cladm           # launch with real project data
cladm --demo    # launch with mock data (try it out without any history)
```

## How it works

cladm reads `~/.claude/history.jsonl` to discover every project you've used with Claude Code, then enriches each one with live git metadata. The result is a fast, keyboard-driven picker that shows you everything at a glance.

## Screenshots

### Project list

The main view shows all discovered projects sorted by most recent Claude usage. Each row displays the project name, git branch, sync status, last commit, working tree state, Claude activity, session count, message count, and detected stack.

<p align="center">
  <img src="assets/screenshot-main.png" alt="Project list view" width="900" />
</p>

| Column | Description |
|--------|-------------|
| **PROJECT** | Relative path from `~/Desktop` |
| **BRANCH** | Current git branch (truncated to 8 chars) |
| **SYNC** | Remote sync: `✓` synced, `↑n` ahead, `↓n` behind, `✗` no remote |
| **COMMIT** | Time since last commit |
| **MESSAGE** | Last commit message |
| **DIRTY** | Working tree: `clean`, or `+staged ~modified ?untracked` |
| **LAST USE** | Time since last Claude session |
| **SES** | Total Claude session count |
| **MSGS** | Total message count across sessions |
| **STACK** | Auto-detected stack tags (ts, py, rust, go, docker, etc.) |

### Expanded view

Press `→` on any project to expand it and see branches and individual sessions with their conversation previews.

<p align="center">
  <img src="assets/screenshot-expanded.png" alt="Expanded view with sessions and branches" width="900" />
</p>

Each session shows:
- **Title** — auto-generated session title
- **Last prompt** — your most recent message
- **Claude's response** — the assistant's last reply
- **Size & age** — session file size and time since last use

Select a branch to launch Claude with a prompt to switch to that branch. Select individual sessions to resume them directly.

## Keybindings

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate |
| `Space` | Toggle selection |
| `→` | Expand project (branches + sessions) |
| `←` | Collapse project |
| `a` | Select all |
| `n` | Deselect all |
| `s` | Cycle sort mode (recent → name → commit → sessions) |
| `Enter` | Launch selected in Terminal.app |
| `PageUp` `PageDown` | Jump 15 rows |
| `Home` `End` | Jump to top/bottom |
| `q` `Esc` | Quit |

## What gets launched

Each selected project opens a new Terminal.app window running:

```bash
cd /path/to/project && claude --dangerously-skip-permissions
```

If you selected a specific session, it resumes it with `--resume <session-id>`. If you selected a non-current branch, it adds a prompt to switch branches first.

Multiple sessions in the same project open as tabs in the same window.

## Stack detection

cladm auto-detects project stacks by checking for common files:

| File | Tag |
|------|-----|
| `package.json` | `node` |
| `pyproject.toml` / `requirements.txt` | `py` |
| `Cargo.toml` | `rust` |
| `go.mod` | `go` |
| `CLAUDE.md` | `claude` |
| `Dockerfile` / `docker-compose.yml` | `docker` |

## Tech stack

- **Runtime**: [Bun](https://bun.sh)
- **UI**: [@opentui/core](https://github.com/pekochan069/opentui) (terminal UI framework)
- **Language**: TypeScript

## License

MIT
