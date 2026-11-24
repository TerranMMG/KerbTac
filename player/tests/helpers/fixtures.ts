import recorderUrl from '../../testdata/recorder.kerbtac?url'
import syntheticUrl from '../../testdata/synthetic.kerbtac?url'

const urls = { recorder: recorderUrl, synthetic: syntheticUrl }

export async function loadFixture(name: keyof typeof urls): Promise<ArrayBuffer> {
  const response = await fetch(urls[name])
  if (!response.ok) throw new Error(`Could not load ${name}.kerbtac (HTTP ${response.status})`)
  return response.arrayBuffer()
}
