import { buildTrailDetail, type TrailDetailRequest } from './trailDetail'

self.onmessage = (event: MessageEvent<TrailDetailRequest>) => {
  const result = buildTrailDetail(event.data)
  const transfer: ArrayBuffer[] = [result.times.buffer, result.wallTimes.buffer, result.wallSources.buffer]
  for (const mesh of [result.ribbon, result.line, result.wall]) {
    if (!mesh) continue
    for (const attr of Object.values(mesh.attributes)) transfer.push(attr.array.buffer as ArrayBuffer)
    if (mesh.index) transfer.push(mesh.index.array.buffer as ArrayBuffer)
  }
  self.postMessage(result, { transfer })
}
