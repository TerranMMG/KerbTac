export interface LabelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LeaderLine {
  startX: number
  startY: number
  endX: number
  endY: number
  length: number
  angle: number
}

/** Screen-space line from the nearest label edge to the model anchor. */
export function labelLeader(rect: LabelRect, anchor: { x: number; y: number }): LeaderLine | null {
  const startX = Math.max(rect.x, Math.min(rect.x + rect.width, anchor.x))
  const startY = Math.max(rect.y, Math.min(rect.y + rect.height, anchor.y))
  const dx = anchor.x - startX
  const dy = anchor.y - startY
  const length = Math.hypot(dx, dy)
  if (length < 2) return null
  return {
    startX,
    startY,
    endX: anchor.x,
    endY: anchor.y,
    length,
    angle: Math.atan2(dy, dx),
  }
}
