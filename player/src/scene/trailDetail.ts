import type { BufferAttribute, BufferGeometry } from 'three'
import { buildHeightWallFromTrail } from './heightWall'
import { createTrailLine } from './trailLine'
import { buildTrailMeshData, type TrailSegmentInput } from './trailMeshData'
import { createTrailRibbon } from './vessel'

export interface TrailDetailRequest {
  segments: TrailSegmentInput[]
  body: string
  radius: number
  color: number
  wall: boolean
}

function pack(geometry: BufferGeometry) {
  const attribute = (attr: BufferAttribute) => ({ array: attr.array, itemSize: attr.itemSize })
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attr]) =>
      [key, attribute(attr as BufferAttribute)])),
    index: geometry.index && attribute(geometry.index),
    timeOrigin: Number(geometry.userData.timeOrigin ?? 0),
    substeps: Number(geometry.userData.substeps ?? 1),
  }
}

export function buildTrailDetail(request: TrailDetailRequest) {
  const { times, centres, rights, breaks, lineTimes, lineCentres, wallPoints, wallSources } =
    buildTrailMeshData(request.segments, request.body, true)
  const ribbon = createTrailRibbon(centres, rights, times, request.color, breaks)
  const line = createTrailLine(lineCentres, lineTimes, request.color)
  const ribbonData = pack(ribbon.geometry)
  const lineData = pack(line.geometry)
  ribbonData.timeOrigin = ribbon.userData.timeOrigin
  lineData.timeOrigin = line.userData.timeOrigin
  const wall = request.wall
    ? pack(buildHeightWallFromTrail(wallPoints, request.radius, `#${request.color.toString(16).padStart(6, '0')}`))
    : null
  return { ribbon: ribbonData, line: lineData, wall, times, wallTimes: Float64Array.from(wallPoints, point => point.t),
    wallSources }
}

export type TrailDetailResult = ReturnType<typeof buildTrailDetail>
