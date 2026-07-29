import path from 'path';

/**
 * Electron apps launched from a desktop shortcut often inherit a stripped PATH
 * that omits System32, so execSync/spawnSync cannot find cmd.exe (ENOENT).
 */
export function withWindowsSafeShellEnv(
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const systemRoot = base.SystemRoot || 'C:\\Windows';
  return {
    ...base,
    ...extra,
    ComSpec: base.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe'),
    PATH: [base.PATH || '', path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter),
  };
}
