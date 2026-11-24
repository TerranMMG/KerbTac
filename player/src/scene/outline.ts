import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Adds one thin white silhouette around the whole marker. The meshes are
 * merged in group-local space first, so a model made of several parts gets a
 * single outer rim instead of a white seam around every internal panel.
 */
export function addSelectionOutline(group: THREE.Group): void {
  if (group.userData.outlines) return

  group.updateMatrixWorld(true)
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert()
  const geometries: THREE.BufferGeometry[] = []
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.name === 'selection-outline') return
    let geometry = child.geometry.clone()
    if (geometry.index) geometry = geometry.toNonIndexed()
    geometry.applyMatrix4(child.matrixWorld)
    geometry.applyMatrix4(inverse)
    geometries.push(geometry)
  })

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  })
  material.userData.baseOpacity = 0.92

  const merged = geometries.length > 0 ? mergeGeometries(geometries, false) : null
  const outlines: THREE.Object3D[] = []
  if (merged) {
    const shell = new THREE.Mesh(merged, material)
    shell.name = 'selection-outline'
    shell.scale.setScalar(1.012)
    shell.visible = Boolean(group.userData.outlineVisible)
    shell.renderOrder = 4
    group.add(shell)
    outlines.push(shell)
  } else {
    // A malformed model should still get a usable, if slightly busier, rim.
    for (const child of geometries) {
      const shell = new THREE.Mesh(child, material.clone())
      shell.name = 'selection-outline'
      shell.scale.setScalar(1.012)
      shell.visible = Boolean(group.userData.outlineVisible)
      shell.renderOrder = 4
      group.add(shell)
      outlines.push(shell)
    }
  }

  group.userData.outlines = outlines
  group.userData.outlineVisible = Boolean(group.userData.outlineVisible)
}

export function setMarkerOutline(group: THREE.Group, visible: boolean): void {
  if (group.userData.outlineVisible === visible) return
  group.userData.outlineVisible = visible
  const outlines = group.userData.outlines as THREE.Object3D[] | undefined
  if (!outlines) return
  for (const outline of outlines) {
    outline.visible = visible
  }
}

/** Multiplies every material's opacity, used for the post-impact fade-out. */
export function setMarkerOpacity(group: THREE.Group, opacity: number): void {
  const value = Math.max(0, Math.min(1, opacity))
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    const materials = Array.isArray(material) ? material : [material]
    for (const item of materials) {
      const base = typeof item.userData.baseOpacity === 'number'
        ? item.userData.baseOpacity
        : 1
      item.transparent = true
      item.opacity = base * value
    }
  })
}
