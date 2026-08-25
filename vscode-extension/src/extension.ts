import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AnalysisOptions,
  AnalysisResult,
  Loader,
  analyzeWorkspace,
  renderMarkdown,
} from './analysis';

const VERSIONS = [
  '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.5', '1.17.1', '1.18.2',
  '1.19.2', '1.19.4', '1.20.1', '1.20.4', '1.20.6', '1.21', '1.21.1',
  '1.21.2', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9',
  '1.21.10', '1.21.11', '26.1', '26.2',
];
const LOADERS: Loader[] = ['forge', 'neoforge', 'fabric', 'quilt'];

let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
let extensionRoot: string | undefined;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function chooseVersion(prompt: string, defaultValue: string): Promise<string | undefined> {
  const value = await vscode.window.showQuickPick(
    [
      ...VERSIONS.map((version) => ({ label: version, description: version === defaultValue ? 'configuração atual' : undefined })),
      { label: 'Outra versão…', description: 'informar manualmente' },
    ],
    { title: prompt, placeHolder: 'Selecione uma versão do Minecraft' },
  );
  if (!value) return undefined;
  if (value.label !== 'Outra versão…') return value.label;
  return vscode.window.showInputBox({
    title: prompt,
    prompt: 'Informe a versão no formato, por exemplo, 1.21.1 ou 26.2',
    value: defaultValue,
    validateInput: (input) => /^[0-9]+(?:\.[0-9]+)+$/.test(input.trim()) ? undefined : 'Use uma versão numérica como 1.21.1.',
  });
}

async function chooseLoader(prompt: string, defaultValue: Loader): Promise<Loader | undefined> {
  const value = await vscode.window.showQuickPick(
    LOADERS.map((loader) => ({ label: loader, description: loader === defaultValue ? 'configuração atual' : undefined })),
    { title: prompt, placeHolder: 'Selecione um loader' },
  );
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
  return { sourceVersion, targetVersion, sourceLoader, targetLoader };
}

async function persistOptions(options: AnalysisOptions): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('modPortToolkit');
  await configuration.update('sourceVersion', options.sourceVersion, vscode.ConfigurationTarget.Workspace);
  await configuration.update('targetVersion', options.targetVersion, vscode.ConfigurationTarget.Workspace);
  await configuration.update('sourceLoader', options.sourceLoader, vscode.ConfigurationTarget.Workspace);
  await configuration.update('targetLoader', options.targetLoader, vscode.ConfigurationTarget.Workspace);
}

function severity(value: string): vscode.DiagnosticSeverity {
  return value === 'high' ? vscode.DiagnosticSeverity.Error
    : value === 'medium' ? vscode.DiagnosticSeverity.Warning
      : value === 'low' ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Hint;
}

function confidence(value: number | undefined): string {
  return value === undefined ? 'confiança não definida' : `confiança editorial ${Math.round(value * 100)}%`;
}

function populateDiagnostics(result: AnalysisResult): void {
  diagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const finding of result.findings) {
    const start = new vscode.Position(Math.max(0, finding.line - 1), Math.max(0, finding.column - 1));
    const end = new vscode.Position(start.line, start.character + Math.max(1, finding.matchedText.length));
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, end),
      `${finding.rule.issue} Sugestão: ${finding.rule.suggestion} (${confidence(finding.rule.confidence)}).`,
      severity(finding.rule.severity),
    );
    diagnostic.code = finding.rule.id;
    diagnostic.source = 'Mod Port Toolkit';
    if (finding.rule.references.length) {
      diagnostic.relatedInformation = finding.rule.references.map((reference) => new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(finding.file), new vscode.Position(0, 0)),
        `Referência: ${reference}`,
      ));
    }
    const current = byFile.get(finding.file) || [];
    current.push(diagnostic);
    byFile.set(finding.file, current);
  }
  for (const [file, items] of byFile) diagnostics.set(vscode.Uri.file(file), items);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'mod';
}

async function saveReport(root: string, options: AnalysisOptions, result: AnalysisResult): Promise<string> {
  const reportsDirectory = path.join(root, 'reports');
  await fs.mkdir(reportsDirectory, { recursive: true });
  const file = path.join(reportsDirectory, `${safeName(path.basename(root))}-${safeName(options.sourceVersion || 'origem')}-to-${safeName(options.targetVersion)}.md`);
  await fs.writeFile(file, renderMarkdown(result, root, path.basename(root)), 'utf8');
  return file;
}

async function analyze(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage('Abra a pasta do mod no VS Code antes de analisar.');
    return;
  }
  const options = await chooseOptions();
  if (!options) return;
  await persistOptions(options);
  output.appendLine(`Analisando ${root}: ${options.sourceVersion} (${options.sourceLoader}) -> ${options.targetVersion} (${options.targetLoader})`);
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Analisando portabilidade do mod', cancellable: false },
      () => analyzeWorkspace(root, options, extensionRoot ? path.join(extensionRoot, 'knowledge-base', 'rules') : undefined),
    );
    populateDiagnostics(result);
    const report = await saveReport(root, options, result);
    output.appendLine(`Arquivos Java: ${result.filesSeen}`);
    output.appendLine(`Regras carregadas: ${result.rulesLoaded}`);
    output.appendLine(`Ocorrências: ${result.findings.length}`);
    output.appendLine(`Regras fora do contexto: ${result.skippedRules.length}`);
    output.appendLine(`Relatório: ${report}`);
    const action = await vscode.window.showInformationMessage(
      `Análise concluída: ${result.findings.length} problema(s) em ${result.filesSeen} arquivo(s).`,
      'Abrir relatório',
      'Abrir Problems',
    );
    if (action === 'Abrir relatório') {
      const document = await vscode.workspace.openTextDocument(report);
      await vscode.window.showTextDocument(document);
    } else if (action === 'Abrir Problems') {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Erro: ${message}`);
    vscode.window.showErrorMessage(`Mod Port Toolkit: ${message}`);
  }
}

async function configure(): Promise<void> {
  const options = await chooseOptions();
  if (options) {
    await persistOptions(options);
    vscode.window.showInformationMessage(`Configuração salva: ${options.sourceVersion} (${options.sourceLoader}) -> ${options.targetVersion} (${options.targetLoader}).`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionRoot = context.extensionPath;
  diagnostics = vscode.languages.createDiagnosticCollection('mod-port-toolkit');
  output = vscode.window.createOutputChannel('Mod Port Toolkit');
  context.subscriptions.push(diagnostics, output);
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.analyze', analyze));
  context.subscriptions.push(vscode.commands.registerCommand('modPortToolkit.configure', configure));
}

export function deactivate(): void {
  diagnostics?.clear();
  output?.dispose();
}
