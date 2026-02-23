# OpenTUI Complete API Reference

> Source: https://github.com/anomalyco/opentui — v0.1.81
> Native terminal UI core written in Zig with TypeScript bindings. Bun >=1.3.0 required.

## Packages
- `@opentui/core` — TypeScript bindings, imperative API, all primitives
- `@opentui/solid` — SolidJS reconciler
- `@opentui/react` — React reconciler

---

## Renderer

### createCliRenderer(config?)

```typescript
const renderer = await createCliRenderer(config?: CliRendererConfig): Promise<CliRenderer>
```

### CliRendererConfig

| Property | Type | Default | Description |
|---|---|---|---|
| `exitOnCtrlC` | boolean | true | Call renderer.destroy() on Ctrl+C |
| `targetFps` | number | 30 | Target frames per second |
| `maxFps` | number | 60 | Maximum FPS for immediate re-renders |
| `useMouse` | boolean | true | Enable mouse input |
| `autoFocus` | boolean | true | Focus nearest focusable on click |
| `enableMouseMovement` | boolean | true | Track mouse movement |
| `useAlternateScreen` | boolean | true | Use alternate screen buffer |
| `openConsoleOnError` | boolean | true | Auto-open console on errors |
| `exitSignals` | NodeJS.Signals[] | — | Signals triggering cleanup |
| `consoleOptions` | ConsoleOptions | — | Console overlay config |
| `onDestroy` | () => void | — | Cleanup callback |

### CliRenderer Methods

**Lifecycle:** `start()`, `pause()`, `stop()`, `suspend()`, `resume()`, `destroy()`
**Rendering:** `requestRender()`, `intermediateRender()`, `idle()`
**Input:** `addInputHandler(fn)`, `prependInputHandler(fn)`, `removeInputHandler(fn)`
**Mouse:** `enableMouse()`, `disableMouse()`, `setMousePointer()`, `hitTest()`, `dumpHitGrid()`
**Selection:** `startSelection()`, `updateSelection()`, `clearSelection()`, `getSelection()`
**Terminal:** `setCursorPosition()`, `setCursorStyle()`, `setCursorColor()`, `setTerminalTitle()`
**Clipboard:** `copyToClipboardOSC52()`, `clearClipboardOSC52()`, `isOsc52Supported()`
**Performance:** `setGatherStats()`, `getStats()`, `resetStats()`
**Getters:** `isRunning`, `controlState`, `useMouse`, `resolution`, `capabilities`, `themeMode`

### Enums

```typescript
enum MouseButton { LEFT, MIDDLE, RIGHT, WHEEL_UP, WHEEL_DOWN }
enum RendererControlState { IDLE, AUTO_STARTED, EXPLICIT_STARTED, EXPLICIT_PAUSED, EXPLICIT_SUSPENDED, EXPLICIT_STOPPED }
```

---

## Layout System (Yoga/Flexbox)

### LayoutOptions

```typescript
interface LayoutOptions {
  width?: number | string
  height?: number | string
  minWidth?: number | string
  maxWidth?: number | string
  minHeight?: number | string
  maxHeight?: number | string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse"
  flexWrap?: "wrap" | "nowrap" | "wrap-reverse"
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  alignContent?: "flex-start" | "flex-end" | "center" | "stretch" | "space-between" | "space-around"
  position?: "relative" | "absolute"
  top?: number
  right?: number
  bottom?: number
  left?: number
  padding?: number
  paddingTop/Right/Bottom/Left?: number
  margin?: number
  marginTop/Right/Bottom/Left?: number
  overflow?: "visible" | "hidden" | "scroll"
}
```

---

## RenderableOptions (extends LayoutOptions)

```typescript
interface RenderableOptions extends LayoutOptions {
  id?: string
  zIndex?: number
  opacity?: number
  visibility?: "visible" | "hidden"
  renderBefore?: Function
  renderAfter?: Function
  onMouseDown?: (event: MouseEvent) => void
  onMouseUp?: (event: MouseEvent) => void
  onClick?: (event: MouseEvent) => void
  onMouseMove?: (event: MouseEvent) => void
  onScroll?: (event: MouseEvent) => void
  onMouseEnter?: (event: MouseEvent) => void
  onMouseLeave?: (event: MouseEvent) => void
  onKeyDown?: (key: KeyEvent) => void
  onPaste?: (event: PasteEvent) => void
  onSizeChange?: (width: number, height: number) => void
}
```

### Renderable Methods

- `add(child)`, `insertBefore(child, anchor)`, `remove(id)`, `getChildren()`
- `focus()`, `blur()`
- `destroy()`, `destroyRecursively()`
- `requestRender()`
- `calculateLayout()`
- Getters/setters for all flex properties

---

## Components

### Box

```typescript
interface BoxOptions extends RenderableOptions {
  backgroundColor?: string | RGBA
  borderStyle?: "single" | "double" | "rounded" | "heavy"
  border?: boolean | ("top" | "right" | "bottom" | "left")[]
  borderColor?: string | RGBA
  customBorderChars?: BorderCharacters
  shouldFill?: boolean
  title?: string
  titleAlignment?: "left" | "center" | "right"
  focusedBorderColor?: ColorInput
  focusable?: boolean
  gap?: number | `${number}%`
  rowGap?: number | `${number}%`
  columnGap?: number | `${number}%`
}
```

### Text

```typescript
interface TextOptions extends TextBufferOptions {
  content?: StyledText | string
}

interface TextBufferOptions extends RenderableOptions {
  fg?: string | RGBA
  bg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
  wrapMode?: "none" | "char" | "word"
  tabIndicator?: string | number
  tabIndicatorColor?: string | RGBA
  truncate?: boolean
}
```

**Methods:** `content` (get/set), `add(text)`, `remove(id)`, `clear()`, `plainText` (getter), `scrollY/scrollX` (get/set), `wrapMode` (get/set)

### Input

```typescript
interface InputRenderableOptions extends Omit<TextareaOptions, "height" | "minHeight" | "maxHeight" | "initialValue"> {
  value?: string
  maxLength?: number       // default 1000
  placeholder?: string
}

enum InputRenderableEvents {
  INPUT = "input"
  CHANGE = "change"
  ENTER = "enter"
}
```

**Methods:** `value` (get/set), `maxLength` (get/set), `placeholder` (get/set), `focus()`, `blur()`, `submit()`, `undo()`, `redo()`

### Textarea

```typescript
interface TextareaOptions extends EditBufferOptions {
  initialValue?: string
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: StyledText | string | null
  placeholderColor?: ColorInput
  keyBindings?: KeyBinding[]
  keyAliasMap?: KeyAliasMap
  onSubmit?: (event: SubmitEvent) => void
}
```

### Select

```typescript
interface SelectOption { name: string; description: string; value?: any }

interface SelectRenderableOptions extends RenderableOptions {
  options?: SelectOption[]
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  selectedBackgroundColor?: ColorInput
  selectedTextColor?: ColorInput
  descriptionColor?: ColorInput
  selectedDescriptionColor?: ColorInput
  showScrollIndicator?: boolean
  wrapSelection?: boolean
  showDescription?: boolean
  font?: ASCIIFontName
  itemSpacing?: number
  fastScrollStep?: number
  keyBindings?: SelectKeyBinding[]
  keyAliasMap?: KeyAliasMap
}

enum SelectRenderableEvents {
  SELECTION_CHANGED = "selectionChanged"
  ITEM_SELECTED = "itemSelected"
}
```

**Methods:** `getSelectedOption()`, `getSelectedIndex()`, `moveUp(steps?)`, `moveDown(steps?)`, `selectCurrent()`, `setSelectedIndex(index)`, `handleKeyPress(key)`

### TabSelect

```typescript
interface TabSelectOption { name: string; description: string; value?: any }

interface TabSelectRenderableOptions extends RenderableOptions {
  height?: number
  options?: TabSelectOption[]
  tabWidth?: number
  backgroundColor / textColor / focused* / selected*: ColorInput
  showScrollArrows?: boolean
  showDescription?: boolean
  showUnderline?: boolean
  wrapSelection?: boolean
}

enum TabSelectRenderableEvents { SELECTION_CHANGED, ITEM_SELECTED }
```

### ScrollBox

```typescript
interface ScrollBoxOptions extends BoxOptions {
  rootOptions?: BoxOptions
  wrapperOptions?: BoxOptions
  viewportOptions?: BoxOptions
  contentOptions?: BoxOptions
  scrollbarOptions?: ScrollBarOptions
  verticalScrollbarOptions?: ScrollBarOptions
  horizontalScrollbarOptions?: ScrollBarOptions
  stickyScroll?: boolean
  stickyStart?: "top" | "bottom" | "left" | "right"
  scrollX?: boolean        // default false
  scrollY?: boolean        // default true
  scrollAcceleration?: ScrollAcceleration
  viewportCulling?: boolean // default true
}
```

**Properties:** `wrapper`, `viewport`, `content`, `scrollTop` (get/set), `scrollLeft` (get/set), `scrollWidth`, `scrollHeight`
**Methods:** `scrollBy(delta, unit?)`, `scrollTo(position)`, `add()`, `insertBefore()`, `remove()`, `getChildren()`
**ScrollUnit:** `"absolute" | "viewport" | "content" | "step"`

### ScrollBar

```typescript
interface ScrollBarOptions extends RenderableOptions {
  orientation: "vertical" | "horizontal"
  showArrows?: boolean
  arrowOptions?: Omit<ArrowOptions, "direction">
  trackOptions?: Partial<SliderOptions>
  onChange?: (position: number) => void
}
```

### Slider

```typescript
interface SliderOptions extends RenderableOptions {
  orientation: "vertical" | "horizontal"
  value?: number
  min?: number
  max?: number
  viewPortSize?: number
  backgroundColor?: ColorInput
  foregroundColor?: ColorInput
  onChange?: (value: number) => void
}
```

### Code

```typescript
interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype?: string
  syntaxStyle: SyntaxStyle  // required
  treeSitterClient?: TreeSitterClient
  conceal?: boolean
  drawUnstyledText?: boolean
  streaming?: boolean
  onHighlight?: OnHighlightCallback
}
```

### Markdown

```typescript
interface MarkdownOptions extends RenderableOptions {
  content?: string
  syntaxStyle: SyntaxStyle
  conceal?: boolean
  treeSitterClient?: TreeSitterClient
  streaming?: boolean
  renderNode?: (token: Token, context: RenderNodeContext) => Renderable | undefined | null
}
```

### ASCIIFont

```typescript
interface ASCIIFontOptions extends RenderableOptions {
  text?: string
  font?: ASCIIFontName     // e.g. "tiny"
  color?: ColorInput | ColorInput[]
  backgroundColor?: ColorInput
  selectable?: boolean
}
```

### Diff

```typescript
interface DiffRenderableOptions extends RenderableOptions {
  diff?: string
  view?: "unified" | "split"
  fg?: ColorInput
  filetype?: string
  syntaxStyle?: SyntaxStyle
  wrapMode?: "none" | "char" | "word"
  showLineNumbers?: boolean
  addedBg / removedBg / contextBg: ColorInput
  addedContentBg / removedContentBg / contextContentBg: ColorInput
}
```

### FrameBuffer

```typescript
interface FrameBufferOptions extends RenderableOptions {
  width: number     // required
  height: number    // required
  respectAlpha?: boolean
}
```

### TextTable

```typescript
interface TextTableOptions extends RenderableOptions {
  content?: TextTableCellContent[][]
  wrapMode?: "none" | "char" | "word"
  columnWidthMode?: "content" | "fill"
  cellPadding?: number
  showBorders?: boolean
  border?: boolean
  outerBorder?: boolean
  borderStyle?: BorderStyle
  borderColor / borderBackgroundColor / backgroundColor: ColorInput
}
```

---

## Color System

```typescript
type ColorInput = string | RGBA

class RGBA extends Float32Array {
  static fromHex(hex: string): RGBA
  static fromInts(r: number, g: number, b: number, a?: number): RGBA
  static fromValues(r: number, g: number, b: number, a?: number): RGBA
  static fromArray(arr: number[]): RGBA
  get r/g/b/a(): number
  set r/g/b/a(v: number)
  toInts(): [number, number, number, number]
  equals(other: RGBA): boolean
}
```

CSS color names (28): red, green, blue, yellow, cyan, magenta, white, black, gray, orange, pink, purple, brightRed, brightGreen, brightBlue, brightYellow, brightCyan, brightMagenta, brightWhite, etc.

---

## Styled Text

```typescript
import { t, bold, italic, underline, strikethrough, dim, reverse, blink, fg, bg, link } from "@opentui/core"

// Tagged template
t`${bold("Hello")} ${fg("#FF0000")("World")}`

// Style functions (nestable)
bold(text)
italic(text)
underline(text)
strikethrough(text)
dim(text)
fg(color)(text)
bg(color)(text)
link(url)(text)

// Named color functions
red(text), green(text), blue(text), yellow(text), cyan(text), magenta(text), white(text), black(text), gray(text)
brightRed(text), brightGreen(text), brightBlue(text), brightYellow(text), brightCyan(text), brightMagenta(text), brightWhite(text)
bgRed(text), bgGreen(text), bgBlue(text), bgYellow(text), bgCyan(text), bgMagenta(text), bgWhite(text), bgBlack(text)
```

---

## Keyboard

### KeyEvent

```typescript
class KeyEvent {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  sequence: string
  raw: string
  eventType: KeyEventType
  source: "raw" | "kitty"
  preventDefault(): void
  stopPropagation(): void
  get defaultPrevented(): boolean
  get propagationStopped(): boolean
}
```

### PasteEvent

```typescript
class PasteEvent {
  text: string
  preventDefault(): void
  stopPropagation(): void
}
```

### Key Binding System

```typescript
interface KeyBinding<T = string> {
  name: string
  action: T
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  super?: boolean
}
```

---

## Animation

```typescript
import { createTimeline } from "@opentui/core"

const tl = createTimeline({ duration?: number, loop?: boolean, autoplay?: boolean })

tl.add({
  targets: any,
  duration: number,
  ease?: EasingFunction,
  onUpdate?: (anim: JSAnimation) => void,
  onComplete?: () => void,
  loop?: boolean,
  alternate?: boolean,
})
```

**Easing functions:** linear, inQuad, outQuad, inOutQuad, inExpo, outExpo, inOutSine, outBounce, inBounce, outElastic, inCirc, outCirc, inOutCirc, inBack, outBack, inOutBack

---

## VNode System

```typescript
import { h } from "@opentui/core"

// Hyperscript-style (with Proxy for method chaining)
h(Box, { width: 100 }, h(Text, { content: "hello" }))

// Or use factory functions directly
Box({ width: 100 }, Text({ content: "hello" }))
```

**Functions:** `isVNode(value)`, `instantiate(vnode, ctx)`, `delegate(vnode, mapping)`, `flattenChildren(children)`

---

## Exports

The package re-exports from: Renderable, types, utils, buffer, text-buffer, edit-buffer, syntax-style, animation/Timeline, lib (KeyHandler, RGBA, border, etc.), renderer, renderables (all components), console, Yoga namespace.
