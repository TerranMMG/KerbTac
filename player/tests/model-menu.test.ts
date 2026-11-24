import { userEvent } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { parseArchive } from '../src/format/validate'
import { CustomModelRegistry } from '../src/scene/customModels'
import { ModelMenuState, mountModelMenu } from '../src/ui/modelMenu'
import { renderShell } from '../src/ui/shell'
import { buildArchive } from './helpers/archive'

const obj = 'v 0 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\n'
const vessel = parseArchive(buildArchive()).vessels[0]!

describe('model menu', () => {
  it('exposes a separate model menu in the player shell', () => {
    expect(renderShell()).toContain('id="btn-models"')
  })

  it('opens the real panel and returns keyboard focus to its opener on Escape', async () => {
    const root = document.createElement('div')
    root.innerHTML = renderShell()
    document.body.append(root)
    try {
      const opener = root.querySelector<HTMLButtonElement>('#btn-models')!
      const panel = root.querySelector<HTMLElement>('#models-panel')!
      const close = root.querySelector<HTMLButtonElement>('#models-close')!
      const menu = mountModelMenu(panel, opener, async () => undefined, () => {}, () => {}, () => {})
      menu.setState(new ModelMenuState([vessel], new CustomModelRegistry()))

      expect(panel.inert).toBe(true)
      await userEvent.click(opener)
      expect(panel.inert).toBe(false)
      expect(opener.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(close)
      expect(panel.querySelector('.model-row')?.getAttribute('data-vessel-id')).toBe(vessel.id)

      await userEvent.keyboard('{Escape}')
      expect(panel.inert).toBe(true)
      expect(opener.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(opener)
    } finally {
      root.remove()
    }
  })

  it('does not list debris or transient actors', () => {
    const state = new ModelMenuState([
      vessel,
      { ...vessel, id: 'wreck', type: 'Debris' },
      { ...vessel, id: 'fragment', modelRole: 'debris' },
      { ...vessel, id: 'actor', transient: true },
    ], new CustomModelRegistry())
    expect(state.vessels.map(item => item.id)).toEqual([vessel.id])
  })

  it('chooses a model for the requested row and resets it to the built-in model', async () => {
    const registry = new CustomModelRegistry()
    const state = new ModelMenuState([vessel], registry)
    expect(state.canSave).toBe(false)
    await state.choose(vessel.id, new File([obj], 'shape.obj'))
    expect(registry.getCustomModel(vessel.id)?.binding.file).toBe('shape.obj')
    expect(state.canSave).toBe(true)
    state.reset(vessel.id)
    expect(registry.getCustomModel(vessel.id)).toBeNull()
    expect(state.canSave).toBe(false)
  })

  it('keeps manual transforms local to the assigned vessel and can reset them', async () => {
    const registry = new CustomModelRegistry()
    const state = new ModelMenuState([vessel], registry)
    await state.choose(vessel.id, new File([obj], 'shape.obj'))
    state.setTransform(vessel.id, { scale: 2, rotation: [0, 90, 0], offset: [1, 2, 3] })
    expect(registry.getCustomModel(vessel.id)?.binding).toMatchObject({ scale: 2, rotation: [0, 90, 0] })
    state.resetTransform(vessel.id)
    expect(registry.getCustomModel(vessel.id)?.binding).toMatchObject({ scale: 1, offset: [0, 0, 0] })
  })

  it('does not install a file that finishes reading after the replay closes', async () => {
    const registry = new CustomModelRegistry()
    const state = new ModelMenuState([vessel], registry)
    const pending = state.choose(vessel.id, new File([obj], 'shape.obj'))
    state.close()
    await pending
    expect(registry.getCustomModel(vessel.id)).toBeNull()
  })
})
