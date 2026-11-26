const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
if (!files.length) throw new Error('No tracked/staged files to audit.');
const envFile = process.env.PRIVATE_ENV_AUDIT_PATH || path.join(root, '.env');
const privateValues = fs.existsSync(envFile) ? Object.entries(dotenv.parse(fs.readFileSync(envFile)))
  .filter(([key, value]) => /key|token|secret|password|cookie|auth|session|_AK$/i.test(key) && value.length >= 8) : [];
const forbidden = /(^|\/)(node_modules|dist|data|uploads|\.aws|\.codex|\.agents)(\/|$)|(^|\/)\.env($|\.(?!example$))|\.(sqlite3?|db)(-|$)|\.(p12|pfx|pem|key|log)$|(^|\/)(settings\.json|\.DS_Store|startup-errors\.log)$/i;
const signatures = [/gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /sk-[A-Za-z0-9_-]{25,}/];
const failures = [];
for (const file of files) {
  if (forbidden.test(file)) failures.push(`${file}: private/runtime file`);
  const mode = execFileSync('git', ['ls-files', '-s', '--', file], { cwd: root, encoding: 'utf8' }).split(' ')[0];
  if (mode === '120000') failures.push(`${file}: symlink requires separate review`);
  const staged = execFileSync('git', ['show', `:${file}`], { cwd: root });
  const text = staged.toString('utf8');
  for (const [key, value] of privateValues) if (text.includes(value)) failures.push(`${file}: matches private configuration field ${key}`);
  if (signatures.some(pattern => pattern.test(text))) failures.push(`${file}: credential signature`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Public source audit passed: ${files.length} files; no private/runtime paths, credential signatures, or matching local secret values. Secret values were not printed.`);
