import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = ['index.html', 'admin/index.html'];
const externalScripts = ['admin/api.js'];
let failures = 0;
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(code => code.trim());
  if (!scripts.length) {
    console.error('No se encontraron scripts inline en ' + file);
    failures++;
    continue;
  }
  scripts.forEach((code, index) => {
    const temp = join(tmpdir(), 'zafire-' + process.pid + '-' + index + '.js');
    writeFileSync(temp, code);
    const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
    unlinkSync(temp);
    if (result.status !== 0) {
      console.error('ERROR ' + file + ' script #' + (index + 1));
      console.error(result.stderr || result.stdout);
      failures++;
    } else {
      console.log('OK ' + file + ' script #' + (index + 1));
    }
  });
}
for (const file of externalScripts) {\n  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });\n  if (result.status !== 0) { console.error('ERROR ' + file); console.error(result.stderr || result.stdout); failures++; }\n  else console.log('OK ' + file);\n}\nif (failures) process.exit(1);
