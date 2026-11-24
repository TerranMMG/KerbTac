import { processParseRequest, type ParseRequest } from './parseWorkerProtocol'

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { response, transfer } = processParseRequest(event.data)
  self.postMessage(response, { transfer })
}
