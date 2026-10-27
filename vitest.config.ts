import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Agent worktrees are nested checkouts with their own copy of tests/.
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
  },
});
