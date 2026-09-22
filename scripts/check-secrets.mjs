import {execFileSync} from 'node:child_process';

// Inspect the index, not just the working tree. Never print matched contents.
const git = args => execFileSync('git', args, {maxBuffer: 32 * 1024 * 1024});
const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString().split('\0').filter(Boolean);
const patterns = [
  /sk-or-v1-[a-f0-9]{32,}/i,
  /AIza[\w-]{30,}/,
  /AQ\.[\w-]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/,
];
const privatePath = /^(?:runtime|release|dist|dist-electron|node_modules|\.test-data)\/|(?:^|\/)(?:\.env(?:\..+)?|credentials\.json|secrets\.json)$|\.(?:sqlite(?:-wal|-shm)?|db|pfx|p12|pem|key|mp4|mov|mkv|webm|avi)$/i;
const violations = [];
for (const file of files) {
  if (privatePath.test(file) && !file.endsWith('.env.example')) {violations.push(file); continue;}
  const data = git(['show', ':' + file]);
  if (data.length > 5 * 1024 * 1024 || patterns.some(pattern => pattern.test(data.toString('utf8')))) violations.push(file);
}
if (violations.length) {
  console.error('Commit blocked: inspect these files for secrets or private/build artifacts:');
  violations.forEach(file => console.error(' - ' + file));
  process.exitCode = 1;
} else console.log(`Secret check passed for ${files.length} staged files (contents not logged).`);
