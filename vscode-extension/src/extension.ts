import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AnalysisOptions,
  AnalysisResult,
  Loader,
  SeverityName,
  analyzeWorkspace,
  coverageReport,
  gitCompare,
  renderMarkdown,
} from './analysis';

const VERSIONS = [
  '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.5', '1.17.1', '1.18.2',
  '1.19.2', '1.19.4', '1.20.1', '1.20.4', '1.20.6', '1.21', '1.21.1',
  '1.21.2', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9',
  '1.21.10', '1.21.11', '26.1', '26.2',
];
const LOADERS: Loader[] = ['forge', 'neoforge', 'fabric', 'quilt'];
const SEVERITIES: SeverityName[] = ['info', 'low', 'medium', 'high'];

let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
let extensionRoot: string | undefined;
let lastResult: AnalysisResult | undefined;

function workspaceRoot(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }
function severityRank(value: string): number { return value === 'high' ? 3 : value === 'medium' ? 2 : value === 'low' ? 1 : 0; }
function severity(value: string): vscode.DiagnosticSeverity {
  return value === 'high' ? vscode.DiagnosticSeverity.Error : value === 'medium' ? vscode.DiagnosticSeverity.Warning : value === 'low' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Hint;
}
function safeName(value: string): string { return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mod'; }
function escaped(value: string): string { return value.replace(/`/g, '\\`'); }

async function chooseVersion(prompt: string, defaultValue: string): Promise<string | undefined> {
  const value = await vscode.window.showQuickPick([
    ...VERSIONS.map((version) => ({ label: version, description: version === defaultValue ? 'configuração atual' : undefined })),
    { label: 'Outra versão…', description: 'informar manualmente' },
  ], { title: prompt, placeHolder: 'Selecione uma versão do Minecraft' });
  if (!value) return undefined;
  if (value.label !== 'Outra versão…') return value.label;
  return vscode.window.showInputBox({ title: prompt, prompt: 'Informe uma versão como 1.21.1 ou 26.2', value: defaultValue, validateInput: (input) => /^\d+(?:\.\d+)+$/.test(input.trim()) ? undefined : 'Use uma versão numérica como 1.21.1.' });
}
async function chooseLoader(prompt: string, defaultValue: Loader): Promise<Loader | undefined> {
  const value = await vscode.window.showQuickPick(LOADERS.map((loader) => ({ label: loader, description: loader === defaultValue ? 'configuração atual' : undefined })), { title: prompt, placeHolder: 'Selecione um loader' });
  return value?.label as Loader | undefined;
}
async function chooseOptions(): Promise<AnalysisOptions | undefined> {
  const configuration = vscode.workspace.getConfiguration('modPortToolkit');
  const sourceVersion = await chooseVersion('Versão de origem do mod', configuration.get<string>('sourceVersion', '1.20.1'));
  if (!sourceVersion) return undefined;
  const targetVersion = await chooseVersion('Versão de destino do mod', configuration.get<string>('targetVersion', '1.21.1'));
  if (!targetVersion) return undefined;
  const sourceLoader = await chooseLoader('Loader de origem', configuration.get<Loader>('sourceLoader', 'forge'));
  if (!sourceLoader) return undefined;
  const targetLoader = await chooseLoader('Loader de destino', configuration.get<Loader>('targetLoader', 'neoforge'));
  if (!targetLoader) return undefined;
  return { sourceVersion, targetVersion, sourceLoader, targetLoader, ast: configuration.get<boolean>('ast', true), dependencies: configuration.get<boolean>('dependencies', true) };
}
async function persistOptions(options: AnalysisOptions): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('modPortToolkit');
  await configuration.update('sourceVersion', options.sourceVersion, vscode.ConfigurationTarget.Workspace);
  await configuration.update('targetVersion', options.targetVersion, vscode.ConfigurationTarget.Workspace);
  await configuration.update('sourceLoader', options.sourceLoader, vscode.ConfigurationTarget.Workspace);
  await configuration.update('targetLoader', options.targetLoader, vscode.ConfigurationTarget.Workspace);
}
function currentOptions(): AnalysisOptions {
  const configuration = vscode.workspace.getConfiguration('modPortToolkit');
  return {
    sourceVersion: configuration.get<string>('sourceVersion', '1.20.1'),
    targetVersion: configuration.get<string>('targetVersion', '1.21.1'),
    sourceLoader: configuration.get<Loader>('sourceLoader', 'forge'),
    targetLoader: configuration.get<Loader>('targetLoader', 'neoforge'),
    ast: configuration.get<boolean>('ast', true),
    dependencies: configuration.get<boolean>('dependencies', true),
  };
}
function filterResult(result: AnalysisResult): AnalysisResult {
  const configuration = vscode.workspace.getConfiguration('modPortToolkit');
  const minimum = configuration.get<SeverityName>('minimumSeverity', 'info');
  const breakingOnly = configuration.get<boolean>('breakingChangesOnly', false);
  const changedOnly = configuration.get<boolean>('changedFilesOnly', false);
  const changed = new Set(result.changedFiles);
  const findings = result.findings.filter((finding) => {
    if (severityRank(finding.rule.severity) < severityRank(minimum)) return false;
    if (breakingOnly && !finding.rule.breakingChange) return false;
    if (changedOnly && !changed.has(path.relative(workspaceRoot() || '', finding.file).replaceAll(path.sep, '/'))) return false;
    return true;
  });
  return { ...result, findings };
}
function populateDiagnostics(result: AnalysisResult): void {
  diagnostics.clear();
  const filtered = filterResult(result);
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const finding of filtered.findings) {
    const start = new vscode.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1));
    const end = new vscode.Position(start.line, start.character + Math.max(1, finding.matchedText.length));
    const evidenceText = finding.evidences.map((item) => `${item.kind}: ${item.description}`).join(' | ');
    const message = `${finding.rule.issue} Sugestão: ${finding.rule.suggestion} Confiança geral ${Math.round(finding.overallConfidence * 100)}%. Evidência: ${evidenceText}`;
    const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), message, severity(finding.rule.severity));
    diagnostic.code = finding.rule.id;
    diagnostic.source = 'Mod Port Toolkit';
    diagnostic.tags = finding.rule.breakingChange ? [vscode.DiagnosticTag.Deprecated] : undefined;
    if (finding.rule.references.length) diagnostic.relatedInformation = finding.rule.references.map((reference) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(finding.file), new vscode.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1))), `Referência: ${reference}`));
    const items = byFile.get(finding.file) || []; items.push(diagnostic); byFile.set(finding.file, items);
  }
  for (const [file, items] of byFile) diagnostics.set(vscode.Uri.file(file), items);
}
async function saveReport(root: string, options: AnalysisOptions, result: AnalysisResult): Promise<string> {
  const reportsDirectory = path.join(root, 'reports'); await fs.mkdir(reportsDirectory, { recursive: true });
  const file = path.join(reportsDirectory, `${safeName(path.basename(root))}-${safeName(options.sourceVersion || 'origem')}-to-${safeName(options.targetVersion)}.md`);
  await fs.writeFile(file, renderMarkdown(result, root, path.basename(root)), 'utf8'); return file;
}
async function analyze(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showWarningMessage('Abra a pasta do mod no VS Code antes de analisar.'); return; }
  const options = await chooseOptions(); if (!options) return; await persistOptions(options);
  output.appendLine(`Analisando ${root}: ${options.sourceVersion} (${options.sourceLoader}) -> ${options.targetVersion} (${options.targetLoader})`);
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Analisando portabilidade do mod', cancellable: false }, () => analyzeWorkspace(root, options, extensionRoot ? path.join(extensionRoot, 'knowledge-base', 'rules') : undefined));
    lastResult = result; populateDiagnostics(result); const report = await saveReport(root, options, result);
    output.appendLine(`Arquivos: ${result.filesSeen}; regras: ${result.rulesLoaded}; achados: ${result.findings.length}; ignoradas: ${result.skippedRules.length}; relatório: ${report}`);
    const action = await vscode.window.showInformationMessage(`Análise concluída: ${result.findings.length} problema(s) em ${result.filesSeen} arquivo(s).`, 'Abrir relatório', 'Abrir Problems', 'Ver evidências');
    if (action === 'Abrir relatório') { const document = await vscode.workspace.openTextDocument(report); await vscode.window.showTextDocument(document); }
    else if (action === 'Abrir Problems') await vscode.commands.executeCommand('workbench.actions.view.problems');
    else if (action === 'Ver evidências') output.show(true);
  } catch (error) { const message = error instanceof Error ? error.message : String(error); output.appendLine(`Erro: ${message}`); vscode.window.showErrorMessage(`Mod Port Toolkit: ${message}`); }
}
async function configure(): Promise<void> { const options = await chooseOptions(); if (options) { await persistOptions(options); vscode.window.showInformationMessage(`Configuração salva: ${options.sourceVersion} (${options.sourceLoader}) -> ${options.targetVersion} (${options.targetLoader}).`); } }
async function audit(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showWarningMessage('Abra a pasta do mod no VS Code antes da auditoria.'); return; }
  const options = currentOptions();
  try { const result = await analyzeWorkspace(root, options, extensionRoot ? path.join(extensionRoot, 'knowledge-base', 'rules') : undefined); lastResult = result; populateDiagnostics(result); const report = await saveReport(root, options, result); output.appendLine(`Auditoria: ${report}`); vscode.window.showInformationMessage(`Auditoria concluída: ${result.findings.length} ocorrência(s), cobertura de regras ${result.totalRules ? Math.round((result.applicableRules / result.totalRules) * 100) : 0}%.`); }
  catch (error) { vscode.window.showErrorMessage(`Mod Port Toolkit: ${error instanceof Error ? error.message : String(error)}`); }
}
async function coverage(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showWarningMessage('Abra a pasta do mod antes de calcular cobertura.'); return; }
  try { const result = lastResult || await analyzeWorkspace(root, currentOptions(), extensionRoot ? path.join(extensionRoot, 'knowledge-base', 'rules') : undefined); lastResult = result; const report = JSON.stringify(coverageReport(result), null, 2) + '\n'; const directory = path.join(root, 'reports'); await fs.mkdir(directory, { recursive: true }); const file = path.join(directory, 'coverage.json'); await fs.writeFile(file, report, 'utf8'); const document = await vscode.workspace.openTextDocument(file); await vscode.window.showTextDocument(document); }
  catch (error) { vscode.window.showErrorMessage(`Mod Port Toolkit: ${error instanceof Error ? error.message : String(error)}`); }
}
async function compare(): Promise<void> {
  const root = workspaceRoot(); if (!root) { vscode.window.showWarningMessage('Abra um repositório Git antes de comparar.'); return; }
  const base = await vscode.window.showInputBox({ title: 'Commit/branch base', value: 'HEAD~1', prompt: 'Ex.: HEAD~1 ou main' }); if (!base) return;
  const head = await vscode.window.showInputBox({ title: 'Commit/branch final', value: 'HEAD', prompt: 'Ex.: HEAD' }); if (!head) return;
  try { const changes = await gitCompare(root, base, head); output.clear(); output.appendLine(`Comparação ${base}..${head}`); changes.forEach(([status, file]) => output.appendLine(`${status}\t${file}`)); output.show(true); vscode.window.showInformationMessage(`${changes.length} arquivo(s) alterado(s) entre ${base} e ${head}.`); }
  catch (error) { vscode.window.showErrorMessage(`Mod Port Toolkit: ${error instanceof Error ? error.message : String(error)}`); }
}
async function previewSuggestion(): Promise<void> {
  const result = lastResult; if (!result) { vscode.window.showInformationMessage('Execute uma análise antes de visualizar sugestões.'); return; }
  const candidates = result.findings.filter((finding) => finding.rule.suggestionObject || finding.rule.before || finding.rule.after);
  if (!candidates.length) { vscode.window.showInformationMessage('Nenhuma sugestão estruturada disponível nesta análise.'); return; }
  const selected = await vscode.window.showQuickPick(candidates.map((finding) => ({ label: `${finding.rule.id} — ${path.basename(finding.file)}:${finding.line}`, finding })), { title: 'Preview de sugestão — nenhuma alteração será aplicada' });
  if (!selected) return;
  const finding = selected.finding; output.clear(); output.appendLine(`Regra: ${finding.rule.id}`); output.appendLine(`Arquivo: ${finding.file}:${finding.line}`); output.appendLine(`Problema: ${finding.rule.issue}`); output.appendLine(`Sugestão: ${finding.rule.suggestion}`); output.appendLine(`Antes: ${finding.rule.before || finding.rule.suggestionObject?.old || 'não definido'}`); output.appendLine(`Depois: ${finding.rule.after || finding.rule.suggestionObject?.new || 'não definido'}`); output.appendLine(`Automatizável: ${finding.rule.automatable}; segurança: ${finding.rule.automationSafety}`); output.appendLine('Nenhum arquivo foi alterado.'); output.show(true);
}
async function addSuppression(uri: vscode.Uri, diagnostic: vscode.Diagnostic): Promise<void> {
  const root = workspaceRoot(); if (!root || typeof diagnostic.code !== 'string') return;
  const reason = await vscode.window.showInputBox({ title: `Justificativa para ignorar ${diagnostic.code}`, prompt: 'A justificativa ficará registrada no arquivo de suppression.', validateInput: (value) => value.trim() ? undefined : 'Informe uma justificativa.' }); if (!reason) return;
  const suppressionFile = path.join(root, '.mod-port-toolkit-ignore.yml'); const relative = path.relative(root, uri.fsPath).replaceAll(path.sep, '/'); const entry = `ignore:\n  - rule: ${diagnostic.code}\n    file: ${relative}\n    line: ${diagnostic.range.start.line + 1}\n    reason: ${JSON.stringify(reason)}\n`;
  let current = ''; try { current = await fs.readFile(suppressionFile, 'utf8'); } catch { /* novo arquivo */ }
  const next = current.trim() ? `${current.trimEnd()}\n  - rule: ${diagnostic.code}\n    file: ${relative}\n    line: ${diagnostic.range.start.line + 1}\n    reason: ${JSON.stringify(reason)}\n` : entry;
  const edit = new vscode.WorkspaceEdit(); if (current) edit.replace(vscode.Uri.file(suppressionFile), new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), next); else { edit.createFile(vscode.Uri.file(suppressionFile), { ignoreIfExists: true }); edit.insert(vscode.Uri.file(suppressionFile), new vscode.Position(0, 0), next); }
  await vscode.workspace.applyEdit(edit); vscode.window.showInformationMessage(`Suppression registrada em ${path.basename(suppressionFile)}. Execute a análise novamente para aplicá-la.`);
}
class SuppressionCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    return context.diagnostics.filter((item) => item.source === 'Mod Port Toolkit' && typeof item.code === 'string').map((item) => { const action = new vscode.CodeAction(`Ignorar ${item.code} com justificativa`, vscode.CodeActionKind.QuickFix); action.command = { title: 'Registrar suppression', command: 'modPortToolkit.suppress', arguments: [document.uri, item] }; return action; });
  }
}
export function activate(context: vscode.ExtensionContext): void {
  extensionRoot = context.extensionPath; diagnostics = vscode.languages.createDiagnosticCollection('mod-port-toolkit'); output = vscode.window.createOutputChannel('Mod Port Toolkit'); context.subscriptions.push(diagnostics, output);
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.analyze', analyze));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.audit', audit));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.configure', configure));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.coverage', coverage));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.compare', compare));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.previewSuggestion', previewSuggestion));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.suppress', addSuppression));
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider(['java', 'json', 'toml', 'properties', 'gradle', 'yaml', 'plaintext'], new SuppressionCodeActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
}
export function deactivate(): void { diagnostics?.clear(); output?.dispose(); }
