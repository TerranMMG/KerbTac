import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { writerFixtureServer } from './tests/helpers/writer-fixture-server.ts'

export default defineConfig({
  plugins: [writerFixtureServer()],
  test: {
    include: ['tests/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: process.env.CHROME_BIN
          ? { executablePath: process.env.CHROME_BIN }
          : { channel: 'chrome' },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
