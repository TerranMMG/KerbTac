import { expect, it } from 'vitest'
import { ListLayout, adjacentFocusableRow } from '../src/ui/listLayout'

it('limits a 500-vessel list to the viewport plus overscan even at the end', () => {
  const layout = new ListLayout([20, ...Array(500).fill(46)])
  expect(layout.window(0, 460)).toEqual({ start: 0, end: 15, before: 0, after: 486 * 46 })
  const end = layout.window(20 + 490 * 46, 460)
  expect(end).toEqual({ start: 487, end: 501, before: 20 + 486 * 46, after: 0 })
})

it('reveals an active event without moving a viewport that already contains it', () => {
  const layout = new ListLayout(Array(100).fill(34))
  expect(layout.reveal(80, 0, 340)).toBe(2414)
  expect(layout.reveal(80, 2500, 340)).toBe(2500)
})

it('traverses keyboard rows in either direction without focusing group headers', () => {
  const rows = [{ focusable: true }, {}, { focusable: true }]
  expect(adjacentFocusableRow(rows, 0, 1)).toBe(2)
  expect(adjacentFocusableRow(rows, 2, -1)).toBe(0)
  expect(adjacentFocusableRow(rows, 2, 1)).toBe(-1)
})
