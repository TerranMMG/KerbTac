import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'

const project = fileURLToPath(new URL('../../../recorder/tools/KerbTac.FixtureGen/KerbTac.FixtureGen.csproj', import.meta.url))
const run = promisify(execFile)

async function generateFixture(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'kerbtac-writer-'))
  try {
    const output = join(dir, 'writer.kerbtac')
    await run(process.env.DOTNET_BIN || 'dotnet', ['run', '--project', project, '--', output], {
      encoding: 'utf8', timeout: 45_000,
    })
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Serve bytes to real browser tests; no Node APIs enter their client bundle. */
export function writerFixtureServer(): Plugin {
  let fixture: Promise<Buffer> | undefined
  return {
    name: 'kerbtac-test-fixtures',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url
        if (url !== '/__kerbtac-test__/writer.kerbtac' && url !== '/__kerbtac-test__/aeroequus.kerbtac') return next()
        try {
          let bytes: Buffer
          if (url.endsWith('/writer.kerbtac')) {
            // Coalesce concurrent writer requests without blocking unrelated
            // browser tabs' Vite module, demo and worker requests.
            fixture ??= generateFixture().catch(error => {
              fixture = undefined
              throw error
            })
            bytes = await fixture
          } else {
            const archive = process.env.KERBTAC_AEROEQUUS_FILE
            if (!archive) {
              res.statusCode = 404
              return res.end()
            }
            bytes = await readFile(archive)
          }
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(bytes)
        } catch (error) {
          res.statusCode = 500
          res.end(String(error))
        }
      })
    },
  }
}
