# cladm

Interactive terminal UI for launching Claude Code sessions across project folders. Built with OpenTUI + Bun.

## Project Overview

A rich TUI app that replaces `~/Desktop/launch-claude.sh`. Scans `~/.claude/history.jsonl` to discover projects, displays them in an interactive multi-select list with metadata (git branch, last commit, dirty status, Claude session stats), and launches selected projects in new Terminal windows with `claude --dangerously-skip-permissions`.

## Tech Stack

- **Runtime**: Bun (>=1.3.0) — use `bun` exclusively, never node/npm/npx
- **UI Framework**: @opentui/core (imperative API, not React/Solid bindings)
- **Language**: TypeScript

## Architecture

```
src/
  index.ts          — Entry point: createCliRenderer, compose layout, input loop
  data/
    history.ts      — Parse ~/.claude/history.jsonl → project list with sessions/msgs/timestamps
    git.ts          — Git metadata: branch, last commit, dirty status (staged/unstaged/untracked)
    scanner.ts      — Filesystem fallback scanner (recursive, skips node_modules etc.)
  components/
    project-list.ts — ScrollBox + selectable rows with checkbox toggles
    header.ts       — Title bar with selected count, sort mode, source label
    footer.ts       — Keybinding hints
    row.ts          — Single project row: checkbox, name, branch, commit, dirty, claude stats, stack tags
  actions/
    launcher.ts     — osascript Terminal.app integration to open claude sessions
    sorter.ts       — Sort logic: recent claude, name, last commit, most sessions
  lib/
    colors.ts       — Theme colors and highlight helpers
    time.ts         — Relative time formatting (time_ago)
```

## Run

```sh
bun run src/index.ts
```

## Key Behaviors

1. **Default mode**: reads `~/.claude/history.jsonl` to discover all projects (sorted by most recently used)
2. **Fallback**: recursive filesystem scan from `~/Desktop` if no history
3. **Interactive picker**: arrow keys navigate, space toggles, `a` all, `n` none, `s` cycles sort, enter launches, `q` quits
4. **Per-row metadata**: project name (relative path), git branch, last commit age + message, dirty status (+staged ~modified ?untracked), last Claude use, session count, message count, stack tags
5. **Launch**: each selected project opens a new Terminal.app window via osascript running `cd <path> && claude --dangerously-skip-permissions`

## OpenTUI Reference

### Quick Start Pattern
```typescript
import { createCliRenderer, Box, Text, ScrollBox, Select, Input } from "@opentui/core"

const renderer = await createCliRenderer({ exitOnCtrlC: true })
renderer.root.add(
  Box({ flexDirection: "column", width: "100%", height: "100%" },
    // children...
  )
)
```

### Core Concepts
- **Constructs** are factory functions: `Box(props, ...children)` → returns VNode
- **Renderables** are class instances: `new BoxRenderable(renderer, options)`
- Use constructs for declarative composition, renderables when you need imperative control
- `renderer.root.add(vnode)` to mount, `.remove(id)` to unmount
- `requestRender()` to trigger re-draw after state changes

### Layout (Yoga/Flexbox)
All components accept flexbox props:
- `flexDirection: "row" | "column" | "row-reverse" | "column-reverse"`
- `justifyContent: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"`
- `alignItems: "flex-start" | "flex-end" | "center" | "stretch" | "baseline"`
- `width/height`: number (chars) or string ("100%", "50%")
- `padding`, `paddingTop/Right/Bottom/Left`, `margin*`, `gap`, `rowGap`, `columnGap`
- `position: "relative" | "absolute"` with `top/right/bottom/left`
- `overflow: "visible" | "hidden" | "scroll"`
- `flexGrow`, `flexShrink`, `flexBasis`

### Box
```typescript
Box({
  borderStyle: "single" | "double" | "rounded" | "heavy",
  border: boolean | ("top" | "right" | "bottom" | "left")[],
  borderColor: string | RGBA,
  backgroundColor: string | RGBA,
  focusedBorderColor: ColorInput,
  title: string,
  titleAlignment: "left" | "center" | "right",
  shouldFill: boolean,
  focusable: boolean,
  gap: number | `${number}%`,
}, ...children)
```

### Text + Styled Text
```typescript
import { Text, t, bold, italic, underline, dim, fg, bg, strikethrough } from "@opentui/core"

Text({
  content: "plain" | t`${bold(fg("#00FFFF")("styled"))}`,
  fg: string | RGBA,
  bg: string | RGBA,
  wrapMode: "none" | "char" | "word",
  truncate: boolean,
  selectable: boolean,
  attributes: number,  // TextAttributes bitmask
})
```

Color helpers: `red()`, `green()`, `blue()`, `yellow()`, `cyan()`, `magenta()`, `white()`, `gray()`, `brightRed()`, etc.
Background: `bgRed()`, `bgGreen()`, `bgBlue()`, `bgYellow()`, etc.

### Input
```typescript
Input({
  placeholder: string,
  maxLength: number,       // default 1000
  value: string,           // initial value
  // Inherits TextareaOptions for colors, keybindings
})
// Events: "input" (each char), "change" (on blur), "enter" (on Enter key)
// Methods: .value, .focus(), .blur(), .submit()
```

### Select
```typescript
Select({
  options: [{ name: string, description: string, value?: any }],
  backgroundColor / textColor / focusedBackgroundColor / focusedTextColor,
  selectedBackgroundColor / selectedTextColor,
  descriptionColor / selectedDescriptionColor,
  showScrollIndicator: boolean,
  wrapSelection: boolean,
  showDescription: boolean,
  itemSpacing: number,
  fastScrollStep: number,
  keyBindings: SelectKeyBinding[],
})
// Events: "selectionChanged", "itemSelected"
// Methods: .getSelectedOption(), .getSelectedIndex(), .moveUp/Down(), .selectCurrent()
```

### ScrollBox
```typescript
ScrollBox({
  scrollX: boolean,        // default false
  scrollY: boolean,        // default true
  stickyScroll: boolean,
  viewportCulling: boolean, // default true
  // Inherits BoxOptions (border, bg, etc.)
})
// Methods: .scrollBy(delta), .scrollTo(pos), .scrollTop/.scrollLeft
// Children added via .add() are delegated to internal content container
```

### Keyboard Handling
```typescript
// Global input handler
renderer.addInputHandler((key: KeyEvent) => {
  key.name     // "a", "return", "escape", "up", "down", etc.
  key.ctrl     // boolean
  key.meta     // boolean (Cmd on mac)
  key.shift    // boolean
  key.preventDefault()
  key.stopPropagation()
})

// Per-component
Box({ onKeyDown: (key) => { ... }, focusable: true })
```

### Colors (RGBA)
```typescript
import { RGBA } from "@opentui/core"
RGBA.fromHex("#FF0000")
RGBA.fromInts(255, 0, 0, 255)
RGBA.fromValues(1.0, 0.0, 0.0, 1.0)
```

### Renderer Lifecycle
```typescript
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  useMouse: true,
  useAlternateScreen: true,
  onDestroy: () => { /* cleanup */ },
})
// renderer.start() — auto-called
// renderer.destroy() — cleanup and exit
```

### Animation
```typescript
import { createTimeline } from "@opentui/core"
const tl = createTimeline()
tl.add({ targets: myRenderable, duration: 500, ease: "outQuad", onUpdate: (anim) => { ... } })
```

### Key Patterns for This Project
- Use `Box` with `flexDirection: "column"` for the main layout (header, list, footer)
- Use `ScrollBox` for the project list (handles overflow + scrolling)
- Build each row as a `Box` with `flexDirection: "row"` containing `Text` elements
- Track selection state in a `Map<number, boolean>` or `boolean[]`
- Use `renderer.addInputHandler()` for global keybinds (q, a, n, s, enter, space, arrows)
- Launch via `Bun.$\`osascript -e '...'\`` or `Bun.spawn()`
- Parse history.jsonl with `Bun.file().text()` + line-by-line JSON.parse
- Git data via `Bun.spawn(["git", "-C", path, ...])`

## Conventions

- Use Bun exclusively (no node, npm, npx)
- Bun auto-loads .env — no dotenv
- Prefer `Bun.file()` over `node:fs`
- Use `Bun.$` for shell commands, `Bun.spawn()` for processes
- No JSDoc comments, no excessive documentation
- camelCase for variables/functions, PascalCase for types/classes
- Keep it simple — this is a launcher, not a framework
