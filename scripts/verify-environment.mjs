import { execFileSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

const checks = [
  { name: 'Node.js', command: isWindows ? 'node.exe' : 'node', args: ['--version'], validate: (v) => /^v24\./.test(v) },
  { name: 'npm', command: isWindows ? 'npm.cmd' : 'npm', args: ['--version'], validate: (v) => Number(v.split('.')[0]) >= 11 },
  { name: 'Git', command: isWindows ? 'git.exe' : 'git', args: ['--version'], validate: () => true },
];

let failed = false;

console.log('AxorOS local environment verification\n');

for (const check of checks) {
  try {
    const output = execFileSync(check.command, check.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }).trim();

    const valid = check.validate(output);
    console.log(`${valid ? 'PASS' : 'FAIL'}  ${check.name}: ${output}`);
    if (!valid) failed = true;
  } catch {
    console.log(`FAIL  ${check.name}: not found`);
    failed = true;
  }
}

if (failed) {
  console.error('\nEnvironment does not meet the AxorOS Step 1 baseline.');
  process.exit(1);
}

console.log('\nEnvironment meets the AxorOS Step 1 baseline.');
