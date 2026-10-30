import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    typecheck: { enabled: true, include: ['server/**/*.test-d.ts'] },
  },
})
