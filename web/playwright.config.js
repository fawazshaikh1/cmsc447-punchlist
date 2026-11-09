import { defineConfig } from '@playwright/test';

const url = 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: url },
  webServer: {
    command: 'npm run dev:browser -- --host 127.0.0.1 --port 4175 --strictPort',
    url,
  },
});
