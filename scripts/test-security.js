#!/usr/bin/env node
/* Офлайн-регрессии по итогам аудита безопасности 27.11.2026.
 * Никаких сетевых запросов и записи файлов. Синхронно — входит в ci-checks. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let passed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); process.exitCode = 1; }
}
function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return e.stdout || ''; }
}
function gitGrep(pattern, paths) {
  return git(['grep', '-I', '-l', '-E', pattern, '--', ...(paths || ['.'])]).trim();
}

/* ---------- P0 ---------- */
test('персональный e-mail отсутствует в истории и в файлах', () => {
  // Строка собрана из частей, чтобы сам тест не содержал запрещённый адрес.
  const email = 'alex.smyslov' + '@mail.ru';
  const hist = git(['log', '--all', '--format=%ae%x09%ce']);
  assert.ok(!hist.includes(email), 'e-mail остался в истории git');
  assert.equal(gitGrep(email.replace(/[.@]/g, '\\$&'), ['*.md', 'js', 'css', 'data', 'docs', '.github']), '', 'e-mail остался в рабочем дереве');
  assert.ok(!fs.existsSync(path.join(ROOT, '.mailmap')), 'mailmap снова содержит старый адрес');
});

test('query-оверрайд аналитики удалён', () => {
  assert.ok(!read('js/visits.js').includes('visitsEndpoint'));
  assert.match(read('scripts/test-visits.js'), /!js\.includes\('visitsEndpoint'\)/);
});

test('старый токен-контур удалён из репозитория', () => {
  assert.equal(git(['ls-files', 'worker']).trim(), '', 'worker/ всё ещё отслеживается');
  assert.equal(git(['ls-files', '.github/workflows/visits-forward.yml']).trim(), '', 'visits-forward.yml жив');
  assert.equal(git(['ls-files', 'scripts/deploy-worker.ps1']).trim(), '', 'deploy-worker.ps1 жив');
  const secretName = 'RENDER_' + 'PROXY_TOKEN';
  assert.equal(gitGrep(secretName, ['scripts', '.github', 'js', 'data']), '', 'секрет остался в коде');
  assert.ok(!read('package.json').includes('deploy:worker'));
  assert.ok(!read('package.json').includes('wrangler'));
});

test('личные мобильные замаскированы (последние четыре цифры)', () => {
  const out = execFileSync('node', ['scripts/mask-phones.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /OK/);
  assert.ok(!/\+7[\s(]*9\d{2}[\s)\-]+\d{3}[\s\-]+\d{2}[\s\-]+\d{2}/.test(read('data/entities.tsv')));
});

test('маскировка автоматическая: парсер, лог и сборка', () => {
  const build = read('build.js');
  assert.match(build, /maskDataTree\(DATA\)/, 'сборка не маскирует data/');
  assert.match(build, /maskPhone\(JSON\.stringify\(out/, 'бандл реестра не маскируется');
  assert.match(read('scripts/collect-tenders.js'), /maskValue\(obj\)/, 'собранные JSON не маскируются');
  assert.match(read('scripts/lib/logger.js'), /maskPhone\(JSON\.stringify/, 'журнал сбора не маскируется');
});

test('маскировка рекурсивная и повтор не ломает данные', () => {
  const { maskValue, maskPhone } = require('./lib/mask-phones');
  const src = { title: 'Тест', phone: '+7 (906) 572-83-19', nested: [{ contact: '8 (919) 491-40-35' }], inn: '7702080289', num: 42 };
  const out = maskValue(src);
  assert.equal(out.phone, '+7 (906) 572-**-**');
  assert.equal(out.nested[0].contact, '8 (919) 491-**-**');
  assert.equal(out.inn, '7702080289');
  assert.equal(out.num, 42);
  assert.equal(maskPhone(out.phone), out.phone, 'маскировка должна быть идемпотентной');
});

test('research-логи и entities.tsv не публикуются на Pages', () => {
  for (const wf of ['.github/workflows/site-deploy.yml', '.github/workflows/tenders-update.yml']) {
    const t = read(wf);
    assert.ok(!t.includes('cp -r css js data'), wf + ': копируется вся папка data');
    assert.match(t, /cp data\/visits-config\.json data\/collect-log\.json _site\/data\//);
    assert.match(t, /cp -r data\/archive\/\. _site\/data\/archive\//);
  }
});

/* ---------- SSRF / URL ---------- */
test('редиректы проверяются по схеме и хосту', () => {
  const t = read('scripts/lib/throttle.js');
  assert.match(t, /_safeUrl\(url, true\)/);
  assert.match(t, /_safeUrl\(String\(new URL\(loc, current\)\), false\)/);
  assert.match(t, /isBlockedHost\(host\)/);
  assert.match(t, /sameSite\(host, this\.allowedBase\)/);
  assert.match(t, /explicitHosts\.has\(host\)/);
  assert.match(t, /MAX_BODY_CHARS/);
  assert.match(t, /raw\.length > MAX_BODY_CHARS/);
  assert.match(read('scripts/collect-tenders.js'), /multiHost: true/);
});

test('safeHttpUrl отсекает javascript:/data:, но сохраняет валидные URL', () => {
  const { safeHttpUrl, makeRecord } = require('./lib/normalize');
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('data:text/html,<script>'), '');
  assert.match(safeHttpUrl('https://etpgpb.ru/api/1'), /^https:\/\//);
  assert.match(safeHttpUrl('http://example.org/x'), /^http:\/\//);
  const rec = makeRecord({ id: 'T:1', title: 'Тест', source: 'gentender', url: 'javascript:alert(1)', platformUrl: 'https://etpgpb.ru/x' });
  assert.match(rec.url, /^https:\/\//);
});

test('уже собранная запись не перезаписывается данными из сети', () => {
  const { makeRecord, dedup } = require('./lib/normalize');
  const prev = makeRecord({ id: 'TESK:1', platformCode: 'TEK', externalId: '1', title: 'ЛЕГАЛЬНОЕ', source: 'gosplan', url: 'https://tektorg.ru/1' });
  const next = makeRecord({ id: 'TESK:1', platformCode: 'TEK', externalId: '1', title: 'ПОДМЕНА', source: 'tektorg-direct', url: 'https://evil.example/1' });
  const out = dedup([prev], [next], 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'ЛЕГАЛЬНОЕ');
  assert.match(out[0].url, /tektorg\.ru/);
});

test('подстрочное совпадение заказчика убрано', () => {
  assert.ok(!read('scripts/lib/match-org.js').includes('text.includes(k)'));
});

test('check-release блокирует опасную схему URL', () => {
  assert.ok(read('scripts/check-release.js').includes('/^https?:\\/\\//i'), 'нет проверки схемы URL');
  assert.match(read('js/tenders.js'), /safeUrl/);
  assert.match(read('js/app.js'), /const safeUrl/);
  assert.match(read('js/print.js'), /const safeUrl/);
});

/* ---------- доступность / лимиты ---------- */
test('гейт сбора не сбрасывает успешный результат и ограничивает повторы', () => {
  const orch = read('scripts/collect-tenders.js');
  assert.ok(!orch.includes("reason: 'already-collected'"));
  assert.match(orch, /writePartialResult/);
  assert.match(orch, /MAX_DAILY_ATTEMPTS/);
  assert.match(read('.github/workflows/ensure-daily.yml'), /attempts >= 2/);
});

test('ограничения размера ответа и регексов на месте', () => {
  assert.match(read('scripts/lib/normalize.js'), /\[а-яё\]\{4,20\}/);
  for (const f of ['zakazrf-direct', 'roseltorg-direct', 'roseltorg']) {
    assert.match(read('scripts/sources/' + f + '.js'), /cp\(parseInt\(n, 16\)\)/, f + ': невалидный code point уронит адаптер');
  }
  assert.match(read('scripts/sources/tektorg-direct.js'), /parse\(res\.body\)\.slice\(0, maxRecords\)/);
});

/* ---------- CI/CD ---------- */
test('GitHub Actions запинены по SHA и не содержат токен в argv', () => {
  for (const f of ['tenders-update.yml', 'site-deploy.yml', 'ensure-daily.yml', 'probe.yml']) {
    const t = read('.github/workflows/' + f);
    assert.ok(!/uses:\s*actions\/[^@\s]+@v\d+/.test(t), f + ': action не запинен');
    assert.ok(!t.includes('Bearer ${{'), f + ': токен в командной строке');
  }
  assert.match(read('scripts/archive.js'), /--config/);
});

/* ---------- P3 ---------- */
test('CSP, антифрейминг, noindex и новый кэш-бастер', () => {
  assert.match(read('index.html'), /Content-Security-Policy/);
  assert.match(read('js/app.js'), /window\.top !== window\.self/);
  for (const f of ['theme-lab.html', 'header-lab.html', 'header-bg-lab.html', 'dark-header-lab.html', 'dark-stats-lab.html']) {
    assert.match(read(f), /name="robots"/, f + ': нет noindex');
  }
  assert.match(read('index.html'), /\?v=2\.72/);
  assert.match(read('print.html'), /\?v=2\.72/);
});

test('CSV-инъекции нейтрализуются во всех экспортах', () => {
  for (const f of ['js/app.js', 'build.js', 'wp-plugin/energo-visits/includes/class-ev-admin.php']) {
    assert.match(read(f), /\^\[=\+\\?\-@/, f + ': нет префикса для формул');
  }
});

test('в исходниках нет случайных CJK-символов', () => {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const cjk = /[\u4E00-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/;
  let checked = 0;
  for (const f of files) {
    if (!/\.(js|html|css|php|md|json|yml|tsv|txt)$/i.test(f)) continue;
    const p = path.join(ROOT, f);
    try { if (fs.statSync(p).size > 2 * 1024 * 1024) continue; } catch (e) { continue; }
    const text = fs.readFileSync(p, 'utf8');
    checked++;
    assert.ok(!cjk.test(text), 'CJK в ' + f);
  }
  assert.ok(checked > 50);
});

if (!process.exitCode) console.log('\nПроверки безопасности пройдены: ' + passed);
