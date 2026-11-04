import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('prunes only clean audit worktrees with every commit on origin and cleans up finished work', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-worktree-'));
  const repo = join(root, 'fixture');
  const env = { ...process.env, AUDIT_GITHUB_ROOT: root, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const script = resolve(process.env.TEST_AUDIT_SCRIPT || 'scripts/ops/audit-worktree.sh');
  const run = (...args: string[]) => spawnSync('bash', [script, ...args, repo], { env, encoding: 'utf8' });
  try {
    git(root, 'init', '--bare', '--initial-branch=main', 'origin.git');
    git(root, 'clone', join(root, 'origin.git'), repo);
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'initial');
    git(repo, 'push', '-u', 'origin', 'main');
    const old = ['clean', 'dirty', 'unpushed'].map((kind, i) => {
      const path = join(root, `.wt-danielle-fixture-20000101-00000${i}`);
      const branch = `danielle/site-audit-old-${kind}`;
      git(repo, 'worktree', 'add', '-b', branch, path, 'origin/main');
      return { path, branch };
    });
    // The clean candidate's extra commit exists only on a non-default origin branch.
    writeFileSync(join(old[0]!.path, 'published'), 'published');
    git(old[0]!.path, 'add', '.');
    git(old[0]!.path, 'commit', '-m', 'published elsewhere');
    git(old[0]!.path, 'push', 'origin', 'HEAD:published');
    writeFileSync(join(old[1]!.path, 'dirty'), 'keep');
    writeFileSync(join(old[2]!.path, 'unpushed'), 'keep');
    git(old[2]!.path, 'add', '.');
    git(old[2]!.path, 'commit', '-m', 'unpushed');
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(old[0]!.path)).toBe(false);
    expect(git(repo, 'branch', '--list', old[0]!.branch)).toBe('');
    for (const w of old.slice(1)) {
      expect(existsSync(w.path)).toBe(true);
      expect(git(repo, 'branch', '--list', w.branch)).toContain(w.branch);
    }
    expect(result.stderr).toContain(`kept ${old[1]!.path} (dirty 1 / unpushed 0)`);
    expect(result.stderr).toContain(`kept ${old[2]!.path} (dirty 0 / unpushed 1)`);
    const fresh = result.stdout.trim();
    expect(fresh).toMatch(/\.wt-danielle-fixture-\d{8}-\d{6}$/);
    expect(existsSync(fresh)).toBe(true);
    const freshBranch = git(fresh, 'branch', '--show-current');
    const cleanup = run('--prune-only');
    expect(cleanup.status, cleanup.stderr).toBe(0);
    expect(existsSync(fresh)).toBe(false);
    expect(git(repo, 'branch', '--list', freshBranch)).toBe('');
    expect(old.slice(1).every(w => existsSync(w.path))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
