// Original low-poly replay markers. Local -Z is forward and +Y is up.
import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type Paint = 'body' | 'accent' | 'dark' | 'sheet-body' | 'sheet-accent'
const mat: Paint = 'body'
export const accent: Paint = 'accent'
const dark: Paint = 'dark'
const sheetBody: Paint = 'sheet-body'
const sheetAccent: Paint = 'sheet-accent'
const palettes = new WeakMap<T.Group, Map<Paint, T.Material>>()
const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z)

export function modelGroup(material: T.Material): T.Group {
  const group = new T.Group()
  palettes.set(group, new Map([['body', material]]))
  return group
}

function paint(group: T.Group, key: Paint): T.Material {
  const palette = palettes.get(group)!
  const existing = palette.get(key)
  if (existing) return existing
  const material = palette.get(mat)!.clone()
  const shade = key === dark ? 0.35 : key === sheetBody ? 1 : 0.67
  if (key === sheetBody || key === sheetAccent) material.side = T.DoubleSide
  material.userData.markerShade = shade
  material.userData.markerPaint = key
  if ('color' in material) {
    const colored = material as T.MeshStandardMaterial
    colored.color.multiplyScalar(shade)
    colored.emissive?.multiplyScalar(shade)
  }
  palette.set(key, material)
  return material
}

function mesh(g: T.Group, geo: T.BufferGeometry, x=0, y=0, z=0, m: Paint = mat) {
  const o = new T.Mesh(geo,paint(g,m))
  o.position.set(x,y,z)
  g.add(o)
  return o
}
export const box = (g: T.Group,w: number,h: number,l: number,x=0,y=0,z=0,m: Paint = mat) => mesh(g,new T.BoxGeometry(w,h,l),x,y,z,m)
function bulb(g: T.Group,w: number,h: number,l: number,x=0,y=0,z=0,m: Paint = mat) {
  const o = mesh(g,new T.SphereGeometry(1,12,8),x,y,z,m)
  o.scale.set(w/2,h/2,l/2)
  return o
}
export function tube(g: T.Group,a: number[],b: number[],rA: number,rB=rA,m: Paint = mat,sides=12) {
  const start = new T.Vector3().fromArray(a), end = new T.Vector3().fromArray(b), dir = start.clone().sub(end)
  const mid = start.clone().lerp(end,.5)
  const o = mesh(g,new T.CylinderGeometry(rA, rB, dir.length(), sides),mid.x,mid.y,mid.z,m)
  o.quaternion.setFromUnitVectors(V(0,1,0),dir.normalize())
  return o
}
// Cross-sections in X/Y, swept from front to back along Z.
export function hull(g: T.Group, sections: number[][], sides=8, m: Paint = mat) {
  const positions=[], ids=[]
  for (const [z,w,h,y=0] of sections) for (let k=0;k<sides;k++) {
    const a=2*Math.PI*k/sides
    positions.push(w*Math.cos(a),y+h*Math.sin(a),z)
  }
  for(let i=0;i<sections.length-1;i++) for(let k=0;k<sides;k++){
    const a=i*sides+k,b=i*sides+(k+1)%sides
    ids.push(a,b,b+sides,a,b+sides,a+sides)
  }
  const tail=(sections.length-1)*sides
  for(let k=1;k<sides-1;k++) ids.push(0,k+1,k,tail,tail+k,tail+k+1)
  const geo = new T.BufferGeometry()
  geo.setAttribute('position', new T.Float32BufferAttribute(positions,3))
  geo.setIndex(ids)
  geo.computeVertexNormals()
  return mesh(g,geo,0,0,0,m)
}
function sheet(g: T.Group, vertices: number[][], indices: number[], m: Paint = mat) {
  const geo = new T.BufferGeometry()
  geo.setAttribute('position',new T.Float32BufferAttribute(vertices.flat(),3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return mesh(g,geo,0,0,0,m)
}
export function wing(g: T.Group, outline: number[][], height: number, y=0, m: Paint = mat) {
  const shape = new T.Shape(outline.map(([x,z]) => new T.Vector2(x,-z)))
  const geo = new T.ExtrudeGeometry(shape,{ depth:height, bevelEnabled:false, steps:1 })
  geo.rotateX(-Math.PI/2)
  return mesh(g,geo,0,y,0,m)
}
function fighter(g: T.Group) {
  hull(g,[[-60,.25,.25],[-43,4,3],[-28,8,5],[-7,9.5,6],[29,10,5.4],[44,6.8,4.3]],10)
  bulb(g,11,8,21,0,4,-19,accent)
  for(const s of [-1,1]){
    // The roots run into the fuselage and engine shoulders, not up to their edges.
    wing(g,[[s*5,-13],[s*13,-8],[s*42,20],[s*41,26],[s*15,27],[s*5,18]],2.2,-1.1)
    wing(g,[[s*4,25],[s*9,26],[s*21,39],[s*21,43],[s*5,42]],1.7,-.6,accent)
    hull(g,[[-4,2.4,2.5],[3,5,4],[37,5,4],[48,4.5,3.8]],8)
      .position.set(s*6.4,-1.2,0)
    tube(g,[s*6.4,-1.2,45],[s*6.4,-1.2,52],3.7,4.1,dark)
    sheet(g,[
      [s*6,1.5,22],[s*7,1.5,42],[s*11,15,37],[s*10,15,32],
      [s*7.5,1.5,22],[s*8.5,1.5,42],[s*12.5,15,37],[s*11.5,15,32],
    ],[0,1,2,0,2,3,4,6,5,4,7,6,0,3,7,0,7,4,1,5,6,1,6,2,3,2,6,3,6,7,0,4,5,0,5,1],accent)
  }
}
function rotary(g: T.Group) {
  hull(g,[[-34,2,3],[-26,12,10],[-8,14,11],[14,12,9],[25,4,5],[49,2,3]])
  bulb(g,21,14,23,0,3,-21,accent)
  box(g,3,16,10,0,5,43)
  tube(g,[0,9,-5],[0,17,-5],2.4)
  box(g,3,2,92,0,17,-5,accent).rotation.y=.52
  box(g,3,2,92,0,17,-5,accent).rotation.y=2.09
  for(const x of [-9,9]){
    tube(g,[x*.55,-6,7],[x,-13,7],1.5)
    tube(g,[x*.55,-6,-11],[x,-13,-11],1.5)
    tube(g,[x,-13,-26],[x,-13,21],1.8,1.8,dark)
  }
}
function wheels(g: T.Group, xs: number[], zs: number[], radius: number, y=-4) {
  for(const x of xs) for(const z of zs) {
    tube(g,[x*.8,y,z],[x*1.12,y,z],radius,radius,dark,10)
  }
}
function rover(g: T.Group) {
  hull(g,[[-27,6,3],[-21,14,5],[18,14,5],[25,10,4]],8)
  box(g,19,10,18,0,6,-10,accent)
  wheels(g,[-14,14],[-17,0,17],5.8)
}
function base(g: T.Group) {
  hull(g,[[-26,21,3],[-20,29,3],[25,29,3],[30,20,3]])
  box(g,31,13,36,-7,7,0)
  const roof=box(g,34,4,38,-7,14,0,accent)
  roof.rotation.z=.09
  box(g,11,27,13,15,12,10)
  box(g,14,3,16,15,25,10,accent)
  tube(g,[15,24,10],[15,34,10],1.2,1.2,dark)
}
function ship(g: T.Group) {
  hull(g,[[-59,1,1],[-46,8,5],[-27,16,8],[32,16,8],[54,12,5]],10)
  box(g,24,4,66,0,5,7,accent)
  hull(g,[[-11,4,4,10],[-3,9,6,12],[20,9,6,12],[28,7,4,10]])
  box(g,11,5,17,0,18,9,accent)
  tube(g,[0,18,13],[0,31,13],1.8,.9)
  box(g,12,2,3,0,29,13,accent)
}
function craft(g: T.Group) {
  hull(g,[[-47,1,1],[-28,9,9],[-15,12,12],[17,11,11],[30,7,7]],10)
  tube(g,[0,0,23],[0,0,43],6,10,accent)
  for(const x of [-1,1]){
    box(g,14,4,15,x*14,0,13,accent)
    bulb(g,12,12,36,x*20,0,12)
  }
  bulb(g,11,5,22,0,7,-24,accent)
}
function debris(g: T.Group) {
  hull(g,[[-15,5,4],[-6,12,4],[13,11,5],[17,7,2]],5)
  sheet(g,[[-5,1,-8],[5,3,-9],[22,9,4],[11,9,15],[2,2,11]],[0,1,2,0,2,3,0,3,4],sheetAccent)
}
function eva(g: T.Group) {
  bulb(g,13,14,12,0,15,0)
  bulb(g,10,7,5,0,15,-4.5,accent)
  bulb(g,13,17,8,0,3,0)
  box(g,9,13,6,0,4,5,accent)
  for(const s of [-1,1]) {
    tube(g,[s*5,8,0],[s*9,-2,-1],2.8)
    tube(g,[s*3,-3,0],[s*4,-14,0],3)
    bulb(g,7,4,8,s*4,-14,-2,dark)
  }
}
function solar(g: T.Group,start: number,end: number,z: number,width=19) {
  const s=Math.sign(end-start)
  box(g,Math.abs(end-start),3,4,(start+end)/2,0,z)
  const panelLength=18
  box(g,panelLength,2,width,end-s*panelLength/2,0,z,accent)
  for(let k=1;k<3;k++) box(g,1,2.3,width,end-s*k*panelLength/3,0,z,dark)
}
function probe(g: T.Group) {
  hull(g,[[-13,9,8],[-8,15,13],[14,15,13],[19,10,8]],6)
  solar(g,-12,-38,0,18)
  solar(g,12,38,0,18)
  tube(g,[0,0,-12],[0,0,-25],4,2,accent)
  bulb(g,11,11,5,0,0,-25,dark)
}
function relay(g: T.Group) {
  hull(g,[[-14,9,9],[-8,12,12],[16,12,12],[24,7,7]],8)
  tube(g,[0,0,-9],[0,0,-22],4,3)
  tube(g,[0,0,-18],[0,0,-25],8,19,accent,18)
  tube(g,[0,0,-21],[0,0,-32],1.7,1.7,dark)
  solar(g,10,40,13,17)
}
function station(g: T.Group) {
  hull(g,[[-37,7,7],[-27,12,12],[38,12,12],[49,8,8]],10)
  box(g,90,7,8,0,0,15)
  for(const s of [-1,1]){
    box(g,25,2,43,s*44,0,15,accent)
    box(g,25,2.6,3,s*44,0,15,dark)
    tube(g,[s*9,0,-14],[s*25,0,-14],6,7)
  }
  tube(g,[0,0,-34],[0,0,-48],6,5,accent)
}
function radar(g: T.Group) {
  box(g,25,8,46)
  box(g,19,11,14,0,8,-14,accent)
  wheels(g,[-12,12],[-16,16],5)
  tube(g,[0,2,8],[0,20,8],3,2)
  const panel=box(g,28,3,16,0,20,8,accent)
  panel.rotation.x=.55
}
function launcher(g: T.Group) {
  hull(g,[[-26,9,5],[-19,15,6],[24,15,6],[29,12,4]],8)
  box(g,18,10,14,0,7,-15,accent)
  for(const s of [-1,1]) box(g,6,8,44,s*12,-4,1,dark)
  box(g,20,9,18,0,6,8)
  box(g,20,6,30,0,11,7,accent).rotation.x=.18
}
function combined(g: T.Group) {
  hull(g,[[-32,9,5],[-23,16,8],[24,17,8],[31,12,6]],8)
  wheels(g,[-15,15],[-22,0,22],6)
  box(g,23,10,17,0,8,-14,accent)
  box(g,25,8,20,0,8,11)
  tube(g,[0,8,18],[0,23,18],3,2.5)
  box(g,11,3,11,0,22,18,accent).rotation.x=.28
  for(const x of [-9,9]) box(g,7,6,20,x,13,8,accent)
}
function rocket(g: T.Group) {
  hull(g,[[-64,.2,.2],[-47,5,5],[-26,7,7],[-22,9,9],[43,9,9],[56,7,7]],12)
  tube(g,[0,0,48],[0,0,64],5,9,accent)
  for(const s of [-1,1]){
    tube(g,[s*9,0,4],[s*9,0,47],4.8)
    tube(g,[s*9,0,-6],[s*9,0,7],1,4.8)
  }
}
function stage(g: T.Group) {
  hull(g,[[-33,8,8],[-27,12,12],[27,12,12],[35,8,8]],10)
  tube(g,[0,0,-35],[0,0,-29],9,9,accent,10)
  tube(g,[0,0,32],[0,0,47],7,13,dark)
  for(let i=0;i<4;i++){
    const fin=box(g,3,15,14,0,10,22,accent)
    const a=i*Math.PI/2
    fin.rotation.z=a
    fin.position.applyAxisAngle(V(0,0,1),a)
  }
}
function fairing(g: T.Group) {
  const v=[], ids=[]
  for(const [z,x,y] of [[-37,.4,.4],[-24,7,8],[-7,13,14],[30,13,14]]) {
    for(let i=0;i<=12;i++){ const a=-1.46+i*2.92/12;v.push([Math.sin(a)*x,Math.cos(a)*y-3,z]) }
  }
  for(let j=0;j<3;j++)for(let i=0;i<12;i++){const p=j*13+i;ids.push(p,p+1,p+14,p,p+14,p+13)}
  sheet(g,v,ids,sheetBody)
  for(const s of [-1,1]) tube(g,[s*12,0,-7],[s*12,0,29],2.5,2.5,accent)
}

const builders = {
  fighter, rotary, rover, base, ship, craft, debris, eva, probe, relay, station,
  radar, launcher, combined, rocket, stage, fairing,
}

export type ProceduralVessel = keyof typeof builders

const sharedVariants = new Map<ProceduralVessel, Map<Paint, T.BufferGeometry>>()

function geometryFor(key: ProceduralVessel): Map<Paint, T.BufferGeometry> {
  const cached = sharedVariants.get(key)
  if (cached) return cached
  const material = new T.MeshBasicMaterial()
  const source = modelGroup(material)
  builders[key](source)
  source.updateMatrixWorld(true)
  const batches = new Map<Paint, T.BufferGeometry[]>()
  const materials = new Set<T.Material>([material])
  for (const object of source.children) {
    const part = object as T.Mesh<T.BufferGeometry, T.Material>
    const paintKey = (part.material.userData.markerPaint ?? mat) as Paint
    materials.add(part.material)
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    if (geometry !== part.geometry) part.geometry.dispose()
    geometry.deleteAttribute('uv')
    geometry.applyMatrix4(part.matrixWorld)
    const batch = batches.get(paintKey) ?? []
    batch.push(geometry)
    batches.set(paintKey, batch)
  }
  const geometries = new Map<Paint, T.BufferGeometry>()
  for (const [paintKey, parts] of batches) {
    if (parts.length === 1) {
      geometries.set(paintKey, parts[0])
      continue
    }
    const merged = mergeGeometries(parts)
    if (!merged) throw new Error(`Cannot merge model ${key}/${paintKey}`)
    for (const part of parts) part.dispose()
    geometries.set(paintKey, merged)
  }
  for (const item of materials) item.dispose()
  sharedVariants.set(key, geometries)
  return geometries
}

export function makeVesselVariant(key: ProceduralVessel, material: T.Material): T.Group {
  const group = modelGroup(material)
  if ('flatShading' in material) material.flatShading = true
  for (const [paintKey, geometry] of geometryFor(key)) {
    const part = mesh(group, geometry, 0, 0, 0, paintKey)
    part.userData.sharedGeometry = true
  }
  return group
}
