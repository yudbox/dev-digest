import { describe, it, expect } from 'vitest';
import { classifyFile, buildSmartDiff } from './classifier.js';

// ── classifyFile ──────────────────────────────────────────────────────────────

describe('classifyFile', () => {
  it('classifies business logic as core', () => {
    expect(classifyFile('src/middleware/rateLimit.ts')).toBe('core');
  });

  it('classifies lock files as boilerplate', () => {
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
    expect(classifyFile('yarn.lock')).toBe('boilerplate');
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
  });

  it('classifies generated files as boilerplate', () => {
    expect(classifyFile('src/api/__generated__/types.ts')).toBe('boilerplate');
    expect(classifyFile('src/schema.generated.ts')).toBe('boilerplate');
    expect(classifyFile('src/types.d.ts')).toBe('boilerplate');
  });

  it('classifies index.ts as wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
    expect(classifyFile('index.ts')).toBe('wiring');
    expect(classifyFile('src/api/index.js')).toBe('wiring');
  });

  it('classifies routes file as wiring', () => {
    expect(classifyFile('src/routes.ts')).toBe('wiring');
    expect(classifyFile('src/api/routes.ts')).toBe('wiring');
  });

  it('classifies config files as wiring', () => {
    expect(classifyFile('src/config.ts')).toBe('wiring');
    expect(classifyFile('jest.config.ts')).toBe('wiring');
  });

  it('classifies server.ts as wiring', () => {
    expect(classifyFile('src/server.ts')).toBe('wiring');
  });

  it('classifies tests as core (not boilerplate)', () => {
    expect(classifyFile('test/rateLimit.test.ts')).toBe('core');
  });

  it('classifies public api endpoint as core', () => {
    expect(classifyFile('src/api/public/webhooks.ts')).toBe('core');
  });

  it('classifies dist output as boilerplate', () => {
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
  });
});

// ── buildSmartDiff ───────────────────────────────────────────────────────────

describe('buildSmartDiff', () => {
  it('groups files by role in core → wiring → boilerplate order', () => {
    const result = buildSmartDiff([
      { path: 'package-lock.json', additions: 100, deletions: 10 },
      { path: 'src/index.ts', additions: 5, deletions: 2 },
      { path: 'src/middleware/rateLimit.ts', additions: 30, deletions: 0 },
    ]);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('sets too_big=true when total lines > 400', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: 50,
      deletions: 50,
    }));
    const result = buildSmartDiff(files);
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(500);
  });

  it('sets too_big=false when total lines ≤ 400', () => {
    const result = buildSmartDiff([
      { path: 'src/foo.ts', additions: 100, deletions: 100 },
    ]);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('initialises finding_lines as empty array', () => {
    const result = buildSmartDiff([{ path: 'src/foo.ts', additions: 1, deletions: 0 }]);
    expect(result.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('omits empty role groups', () => {
    const result = buildSmartDiff([{ path: 'src/foo.ts', additions: 1, deletions: 0 }]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.role).toBe('core');
  });
});
