const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('manifesto declara todos os comandos de revisão somente leitura', () => {
  const commands = new Set(manifest.contributes.commands.map((item) => item.command));
  for (const command of [
    'modPortToolkit.analyze',
    'modPortToolkit.audit',
    'modPortToolkit.configure',
    'modPortToolkit.coverage',
    'modPortToolkit.compare',
    'modPortToolkit.previewSuggestion',
    'modPortToolkit.suppress',
  ]) assert.ok(commands.has(command), `comando ausente: ${command}`);
});

test('manifesto declara escolha de versão, loader, filtros e análise', () => {
  const properties = manifest.contributes.configuration.properties;
  for (const property of [
    'sourceVersion', 'targetVersion', 'sourceLoader', 'targetLoader', 'ast',
    'dependencies', 'minimumSeverity', 'breakingChangesOnly', 'changedFilesOnly',
  ]) assert.ok(properties[`modPortToolkit.${property}`], `setting ausente: ${property}`);
  assert.deepEqual(properties['modPortToolkit.targetLoader'].enum, ['forge', 'neoforge', 'fabric', 'quilt']);
});

test('manifesto identifica repositório privado sem habilitar publicação automática', () => {
  assert.equal(manifest.repository.url, 'https://github.com/Thiag798/mod-port-toolkit.git');
  assert.equal(manifest.repository.directory, 'vscode-extension');
  assert.equal(manifest.scripts.package.includes('vsce package'), true);
  assert.equal(manifest.scripts.package.includes('publish'), false);
});

test('vscodeignore não inclui fontes e relatórios desnecessários no pacote', () => {
  const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
  const ignoredEntries = new Set(ignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  for (const entry of ['src/**', 'test/**', 'node_modules/**', '*.ts']) assert.ok(ignoredEntries.has(entry), `entrada ausente: ${entry}`);
});
