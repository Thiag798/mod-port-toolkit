const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyzeWorkspace, coverageReport, readRules } = require('../dist/analysis.js');

const root = path.resolve(__dirname, '..', '..');
const fixture = path.join(root, 'tests', 'context-project');

test('carrega a base versionada sem quebrar o schema', async () => {
  const rules = await readRules(root);
  assert.ok(rules.length >= 10);
  assert.ok(rules.some((rule) => rule.id === 'model-event-change'));
  assert.ok(rules.some((rule) => rule.id === 'flattening-block-grass'));
});

test('aplica contexto selecionado e exibe achados no projeto fixture', async () => {
  const result = await analyzeWorkspace(fixture, {
    sourceVersion: '1.20.1',
    targetVersion: '1.21.1',
    sourceLoader: 'forge',
    targetLoader: 'neoforge',
  }, path.join(root, 'knowledge-base', 'rules'));
  assert.equal(result.filesSeen, 3);
  assert.equal(result.context.loader, 'neoforge');
  assert.equal(result.context.javaVersion, '21');
  assert.ok(result.findings.some((finding) => finding.rule.id === 'model-event-change'));
});

test('carrega suppression externa com justificativa e preserva outros achados', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-port-toolkit-'));
  fs.cpSync(fixture, temporary, { recursive: true });
  fs.writeFileSync(path.join(temporary, '.mod-port-toolkit-ignore.yml'), [
    'ignore:',
    '  - rule: model-event-change',
    '    file: src/ContextExample.java',
    '    line: 5',
    '    reason: "Caso revisado"',
    '',
  ].join('\n'));
  const result = await analyzeWorkspace(temporary, {
    sourceVersion: '1.20.1',
    targetVersion: '1.21.1',
    sourceLoader: 'forge',
    targetLoader: 'neoforge',
  }, path.join(root, 'knowledge-base', 'rules'));
  assert.equal(result.findings.some((finding) => finding.rule.id === 'model-event-change' && finding.line === 5), false);
  assert.equal(result.findings.some((finding) => finding.rule.id === 'model-event-change' && finding.line === 6), true);
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('calcula cobertura da base e preserva a análise estrutural configurada', async () => {
  const result = await analyzeWorkspace(fixture, {
    sourceVersion: '1.20.1',
    targetVersion: '1.21.1',
    sourceLoader: 'forge',
    targetLoader: 'neoforge',
    ast: true,
    dependencies: true,
  }, path.join(root, 'knowledge-base', 'rules'));
  const coverage = coverageReport(result);
  assert.equal(coverage.totalRules > 0, true);
  assert.equal(coverage.applicableRules > 0, true);
  assert.equal(coverage.findings > 0, true);
  assert.equal(result.options.ast, true);
});

test('não reporta padrões que só aparecem em comentários', async () => {
  const result = await analyzeWorkspace(root, {
    sourceVersion: '1.12.2',
    targetVersion: '1.20.1',
    sourceLoader: 'forge',
    targetLoader: 'forge',
  });
  const commandFindings = result.findings.filter((finding) => finding.rule.id === 'commands-literal-wrapper');
  assert.ok(commandFindings.length > 0);
  assert.ok(commandFindings.every((finding) => finding.lineText.includes('Commands.literal') && !finding.lineText.startsWith('//')));
});
