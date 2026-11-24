export class ListLayout {
  private readonly offsets = [0]

  constructor(heights: readonly number[]) {
    for (const height of heights) this.offsets.push(this.offsets[this.offsets.length - 1]! + height)
  }

  private bound(value: number, inclusive: boolean): number {
    let lo = 0
    let hi = this.offsets.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const at = this.offsets[mid]!
      if (at < value || (inclusive && at === value)) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  window(top: number, height: number) {
    const count = this.offsets.length - 1
    const start = Math.max(0, this.bound(top, true) - 1 - 4)
    const end = Math.min(count, this.bound(top + height, false) + 4)
    return { start, end, before: this.offsets[start]!, after: this.offsets[count]! - this.offsets[end]! }
  }

  reveal(index: number, top: number, height: number): number {
    const start = this.offsets[index]
    const end = this.offsets[index + 1]
    if (start === undefined || end === undefined) return top
    return start < top ? start : end > top + height ? end - height : top
  }
}

export interface ListRow {
  height: number
  focusable?: boolean
  render(): HTMLElement
}

export function adjacentFocusableRow(rows: readonly Pick<ListRow, 'focusable'>[], index: number, step: 1 | -1): number {
  for (let i = index + step; i >= 0 && i < rows.length; i += step) {
    if (rows[i]?.focusable) return i
  }
  return -1
}

export class VirtualList {
  private readonly listeners = new AbortController()
  private readonly resize: ResizeObserver
  private layout = new ListLayout([])
  private rows: ListRow[] = []
  private windowKey = ''
  private readonly mounted = new Map<number, HTMLElement>()
  private readonly before = document.createElement('div')
  private readonly after = document.createElement('div')

  constructor(private readonly viewport: HTMLElement) {
    const { signal } = this.listeners
    for (const spacer of [this.before, this.after]) spacer.setAttribute('aria-hidden', 'true')
    viewport.append(this.before, this.after)
    viewport.addEventListener('scroll', () => this.render(), { signal })
    this.resize = new ResizeObserver(() => {
      // Resize observation must not synchronously mutate the observed
      // subtree: mounting a different window can resize its parent.
      queueMicrotask(() => { if (!signal.aborted) this.render() })
    })
    this.resize.observe(viewport)
    viewport.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const current = Number((event.target as HTMLElement).dataset.virtualIndex)
      if (!Number.isInteger(current)) return
      const next = adjacentFocusableRow(this.rows, current, event.shiftKey ? -1 : 1)
      if (next < 0) return
      event.preventDefault()
      this.reveal(next)
      this.mounted.get(next)?.focus({ preventScroll: true })
    }, { signal })
  }

  dispose(): void {
    this.listeners.abort()
    this.resize.disconnect()
    this.rows = []
    for (const node of this.mounted.values()) node.remove()
    this.mounted.clear()
    this.before.remove()
    this.after.remove()
  }

  replace(rows: ListRow[]): void {
    this.rows = rows
    this.layout = new ListLayout(rows.map(row => row.height))
    this.windowKey = ''
    const focused = Number((document.activeElement as HTMLElement | null)?.dataset.virtualIndex)
    const retained = this.mounted.get(focused) === document.activeElement
    for (const node of this.mounted.values()) node.remove()
    this.mounted.clear()
    this.render()
    if (retained) this.mounted.get(focused)?.focus({ preventScroll: true })
  }

  reveal(index: number): void {
    this.viewport.scrollTop = this.layout.reveal(index, this.viewport.scrollTop, this.viewport.clientHeight)
    this.render()
  }

  private render(): void {
    const { viewport } = this
    const top = viewport.scrollTop
    const { start, end, before, after } = this.layout.window(top, viewport.clientHeight || 400)
    const key = `${start}:${end}`
    if (key === this.windowKey) return
    this.windowKey = key
    this.before.style.height = `${before}px`
    this.after.style.height = `${after}px`
    for (const [index, node] of this.mounted) {
      if (index >= start && index < end) continue
      node.remove()
      this.mounted.delete(index)
    }
    let anchor: HTMLElement = this.after
    for (let index = end - 1; index >= start; index--) {
      let node = this.mounted.get(index)
      if (!node) {
        node = this.rows[index]!.render()
        node.dataset.virtualIndex = String(index)
        this.mounted.set(index, node)
        viewport.insertBefore(node, anchor)
      }
      anchor = node
    }
    viewport.scrollTop = top
  }
}
