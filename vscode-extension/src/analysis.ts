import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

export type Loader = 'forge' | 'neoforge' | 'fabric' | 'quilt';
export type MatchIn = 'code' | 'strings' | 'both';
export type SeverityName = 'low' | 'medium' | 'high' | 'info';

export interface VersionRange {
  minimum?: string;
  maximum?: string;
}

export interface Rule {
  id: string;
  patterns: string[];
  issue: string;
  suggestion: string;
  severity: SeverityName;
  appliesTo?: string;
  confidence?: number;
  references: string[];
  loaders: string[];
  sourceVersions?: VersionRange;
  targetVersions?: VersionRange;
  matchIn: MatchIn;
  file: string;
}

export interface Finding {
  rule: Rule;
  file: string;
  line: number;
  column: number;
  lineText: string;
  matchedText: string;
  pattern: string;
}

export interface SkippedRule {
  rule: Rule;
  reason: string;
}

export interface DetectedContext {
  loader?: Loader | 'ambiguous';
  javaVersion?: string;
  mappings: string[];
  dependencies: string[];
  evidence: string[];
}

export interface AnalysisOptions {
  sourceVersion?: string;
  targetVersion: string;
  sourceLoader?: Loader;
  targetLoader?: Loader;
}

export interface AnalysisResult {
  findings: Finding[];
  skippedRules: SkippedRule[];
  filesSeen: number;
  rulesLoaded: number;
  context: DetectedContext;
  options: AnalysisOptions;
}

const VERSION_RE = /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/;
const LEGACY_CONDITION_RE = /^(?:(source|target)\s*)?(<=|>=|==|<|>)\s*(\d+(?:\.\d+)+)$/i;
const IGNORED_DIRECTORIES = new Set(['.git', '.gradle', 'node_modules', 'build', 'out', 'bin', 'dist']);

function stringValue(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Campo obrigatório ausente: ${field}.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`O campo '${field}' deve ser texto.`);
  const result = value.trim();
  if (required && result.length === 0) throw new Error(`O campo obrigatório '${field}' não pode ser vazio.`);
  return result || undefined;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`O campo '${field}' deve ser texto ou lista de textos.`);
  }
  return values.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`Todos os itens de '${field}' devem ser textos não vazios.`);
    }
    return item.trim();
  });
}

function versionKey(value: string): number[] {
  const match = /^(\d+(?:\.\d+)*)/.exec(value);
  if (!match) throw new Error(`Versão inválida: '${value}'.`);
  return match[1].split('.').map(Number);
}

function compareVersions(left: string, right: string): number {
  const a = versionKey(left);
  const b = versionKey(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function validateVersion(value: string, field: string): string {
  if (!VERSION_RE.test(value)) throw new Error(`Versão inválida em '${field}': '${value}'.`);
  return value;
}

function parseRange(value: unknown, field: string): VersionRange | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const match = /^(<=|>=|==|<|>)?\s*(\d+(?:\.\d+)+)$/.exec(value.trim());
    if (!match) throw new Error(`O campo '${field}' deve ser uma versão ou comparação de versão.`);
    const version = validateVersion(match[2], field);
    if (match[1] === '>=' || match[1] === '>') return { minimum: version };
    if (match[1] === '<=' || match[1] === '<') return { maximum: version };
    return { minimum: version, maximum: version };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`O campo '${field}' deve ser texto ou objeto com min/max.`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== 'min' && key !== 'max');
  if (unknown.length) throw new Error(`Campos desconhecidos em '${field}': ${unknown.join(', ')}.`);
  const minimum = stringValue(record.min, `${field}.min`);
  const maximum = stringValue(record.max, `${field}.max`);
  if (!minimum && !maximum) throw new Error(`O intervalo '${field}' precisa de min ou max.`);
  if (minimum) validateVersion(minimum, `${field}.min`);
  if (maximum) validateVersion(maximum, `${field}.max`);
  if (minimum && maximum && compareVersions(minimum, maximum) > 0) {
    throw new Error(`O intervalo '${field}' possui min maior que max.`);
  }
  return { minimum, maximum };
}

function parseLegacyConditions(expression: string): Array<[string, string, string]> {
  return expression.split(/\s+AND\s+/i).map((part) => {
    const match = LEGACY_CONDITION_RE.exec(part.trim());
    if (!match) throw new Error("Expressão 'applies_to' inválida. Use, por exemplo, 'source<1.13 AND target>=1.13'.");
    return [match[1]?.toLowerCase() || 'target', match[2], match[3]];
  });
}

function parseRule(value: unknown, index: number, file: string): Rule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file}, regra #${index}: a regra deve ser um objeto YAML.`);
  }
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id, `rules[${index}].id`, true)!;
  const patterns = stringArray(record.patterns ?? record.pattern, `rules[${index}].pattern`);
  if (!patterns.length) throw new Error(`${file}, regra '${id}': informe pattern ou patterns.`);
  const appliesTo = stringValue(record.applies_to, `rules[${index}].applies_to`);
  if (appliesTo) parseLegacyConditions(appliesTo);
  const confidenceValue = record.confidence;
  let confidence: number | undefined;
  if (confidenceValue !== undefined && confidenceValue !== null) {
    if (typeof confidenceValue !== 'number' || !Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1) {
      throw new Error(`${file}, regra '${id}': confidence deve ser um número entre 0 e 1.`);
    }
    confidence = confidenceValue;
  }
  const severity = stringValue(record.severity, `rules[${index}].severity`) || 'info';
  if (!['low', 'medium', 'high', 'info'].includes(severity)) {
    throw new Error(`${file}, regra '${id}': severity deve ser low, medium, high ou info.`);
  }
  const matchIn = stringValue(record.match_in, `rules[${index}].match_in`) || 'code';
  if (!['code', 'strings', 'both'].includes(matchIn)) {
    throw new Error(`${file}, regra '${id}': match_in deve ser code, strings ou both.`);
  }
  const allowed = new Set([
    'id', 'pattern', 'patterns', 'issue', 'suggestion', 'severity', 'applies_to', 'confidence',
    'match_in', 'loader', 'loaders', 'references', 'source_versions', 'target_versions',
  ]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${file}, regra '${id}': campos desconhecidos: ${unknown.join(', ')}.`);
  return {
    id,
    patterns,
    issue: stringValue(record.issue, `rules[${index}].issue`) || 'Não informado.',
    suggestion: stringValue(record.suggestion, `rules[${index}].suggestion`) || 'Não informada.',
    severity: severity as SeverityName,
    appliesTo,
    confidence,
    references: stringArray(record.references, `rules[${index}].references`),
    loaders: stringArray(record.loaders ?? record.loader, `rules[${index}].loader`),
    sourceVersions: parseRange(record.source_versions, `rules[${index}].source_versions`),
    targetVersions: parseRange(record.target_versions, `rules[${index}].target_versions`),
    matchIn: matchIn as MatchIn,
    file,
  };
}

async function yamlFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        result.push(path.join(current, entry.name));
      }
    }
  }
  await walk(root);
  return result;
}

export async function readRules(workspaceRoot: string, rulesRootOverride?: string): Promise<Rule[]> {
  const ruleRoot = rulesRootOverride || path.join(workspaceRoot, 'knowledge-base', 'rules');
  let files: string[] = [];
  try {
    const stat = await fs.stat(ruleRoot);
    files = stat.isDirectory() ? await yamlFiles(ruleRoot) : [ruleRoot];
  } catch {
    const legacy = path.join(workspaceRoot, 'knowledge-base', 'rules.yaml');
    try {
      await fs.access(legacy);
      files = [legacy];
    } catch {
      throw new Error(`Base de regras não encontrada em '${ruleRoot}'.`);
    }
  }
  const rules: Rule[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    let document: unknown;
    try {
      document = yaml.load(await fs.readFile(file, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`YAML inválido em '${file}': ${message}`);
    }
    if (document === null || document === undefined) continue;
    let values: unknown = document;
    if (typeof document === 'object' && !Array.isArray(document)) {
      const record = document as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'rules')) {
        throw new Error(`A raiz de '${file}' deve ser uma lista ou conter somente 'rules'.`);
      }
      values = record.rules;
    }
    if (!Array.isArray(values)) throw new Error(`A raiz de '${file}' deve ser uma lista de regras.`);
    values.forEach((value, index) => {
      const rule = parseRule(value, index + 1, path.relative(workspaceRoot, file));
      if (ids.has(rule.id)) throw new Error(`ID de regra duplicado: '${rule.id}'.`);
      ids.add(rule.id);
      rules.push(rule);
    });
  }
  return rules;
}

async function projectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path.join(current, entry.name));
      } else if (entry.isFile()) {
        result.push(path.join(current, entry.name));
      }
    }
  }
  await walk(root);
  return result;
}

async function detectContext(root: string): Promise<DetectedContext> {
  const files = await projectFiles(root);
  const texts = new Map<string, string>();
  for (const file of files) {
    try {
      texts.set(file, (await fs.readFile(file, 'utf8')).slice(0, 1_000_000).toLowerCase());
    } catch {
      // Arquivos que não podem ser lidos não participam da detecção.
    }
  }
  const loaderMarkers: Record<Loader, string[]> = {
    forge: ['mods.toml', 'net.minecraftforge'],
    neoforge: ['neoforge.mods.toml', 'net.neoforged'],
    fabric: ['fabric.mod.json', 'net.fabricmc'],
    quilt: ['quilt.mod.json', 'org.quiltmc'],
  };
  const loaders: Loader[] = [];
  const evidence: string[] = [];
  for (const [loader, markers] of Object.entries(loaderMarkers) as Array<[Loader, string[]]>) {
    const match = [...texts.entries()].find(([file, text]) => {
      const fileName = path.basename(file).toLowerCase();
      return markers.some((marker) => fileName === marker.toLowerCase() || text.includes(marker));
    });
    if (match) {
      loaders.push(loader);
      evidence.push(`${loader}: ${path.relative(root, match[0])}`);
    }
  }
  let javaVersion: string | undefined;
  const javaPatterns = [
    /languageversion\s*=\s*javalanguageversion\.of\(\s*(\d+)\s*\)/i,
    /(?:sourcecompatibility|targetcompatibility)\s*=\s*['"]?(\d+)/i,
    /java_version\s*[=:]\s*['"]?(\d+)/i,
  ];
  for (const [file, text] of texts) {
    for (const pattern of javaPatterns) {
      const match = pattern.exec(text);
      if (match) {
        javaVersion = match[1];
        evidence.push(`java ${javaVersion}: ${path.relative(root, file)}`);
        break;
      }
    }
    if (javaVersion) break;
  }
  const mappingMarkers: Record<string, string[]> = {
    yarn: ['yarn'],
    mojmap: ['mojmap', 'official mappings'],
    srg: ['srg', 'searge'],
    parchment: ['parchment'],
  };
  const mappings: string[] = [];
  for (const [name, markers] of Object.entries(mappingMarkers)) {
    const match = [...texts.entries()].find(([, text]) => markers.some((marker) => text.includes(marker)));
    if (match) {
      mappings.push(name);
      evidence.push(`mapping ${name}: ${path.relative(root, match[0])}`);
    }
  }
  const dependencyMarkers: Record<string, string[]> = {
    jei: ['jei', 'justenoughitems'],
    curios: ['curios'],
    create: ['create'],
    geckolib: ['geckolib', 'gecko lib'],
  };
  const dependencies: string[] = [];
  for (const [name, markers] of Object.entries(dependencyMarkers)) {
    const match = [...texts.entries()].find(([, text]) => markers.some((marker) => text.includes(marker)));
    if (match) {
      dependencies.push(name);
      evidence.push(`dependency ${name}: ${path.relative(root, match[0])}`);
    }
  }
  return {
    loader: loaders.length === 1 ? loaders[0] : loaders.length > 1 ? 'ambiguous' : undefined,
    javaVersion,
    mappings,
    dependencies,
    evidence: [...new Set(evidence)],
  };
}

function lexicalView(text: string, mode: MatchIn): string {
  const keepCode = mode === 'code' || mode === 'both';
  const keepStrings = mode === 'strings' || mode === 'both';
  const blank = (character: string): string => character === '\n' ? '\n' : ' ';
  const output: string[] = [];
  let state: 'code' | 'lineComment' | 'blockComment' | 'string' | 'char' | 'textBlock' = 'code';
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const two = text.slice(index, index + 2);
    const three = text.slice(index, index + 3);
    if (state === 'code') {
      if (two === '//') { output.push('  '); index += 2; state = 'lineComment'; }
      else if (two === '/*') { output.push('  '); index += 2; state = 'blockComment'; }
      else if (three === '\"\"\"') { output.push(...[...three].map((c) => keepStrings ? c : blank(c))); index += 3; state = 'textBlock'; }
      else if (character === '"') { output.push(keepStrings ? character : blank(character)); index++; state = 'string'; }
      else if (character === "'") { output.push(keepStrings ? character : blank(character)); index++; state = 'char'; }
      else { output.push(keepCode ? character : blank(character)); index++; }
    } else if (state === 'lineComment') {
      output.push(blank(character)); index++; if (character === '\n') state = 'code';
    } else if (state === 'blockComment') {
      if (two === '*/') { output.push('  '); index += 2; state = 'code'; }
      else { output.push(blank(character)); index++; }
    } else if (state === 'string' || state === 'char') {
      output.push(keepStrings ? character : blank(character)); index++;
      if (character === '\\' && index < text.length) { output.push(keepStrings ? text[index] : blank(text[index])); index++; }
      else if ((state === 'string' && character === '"') || (state === 'char' && character === "'")) state = 'code';
    } else {
      if (three === '\"\"\"') { output.push(...[...three].map((c) => keepStrings ? c : blank(c))); index += 3; state = 'code'; }
      else { output.push(keepStrings ? character : blank(character)); index++; }
    }
  }
  return output.join('');
}

function matchesRange(version: string, range: VersionRange): boolean {
  return (!range.minimum || compareVersions(version, range.minimum) >= 0) && (!range.maximum || compareVersions(version, range.maximum) <= 0);
}

function matchesCondition(version: string, operator: string, expected: string): boolean {
  const comparison = compareVersions(version, expected);
  return operator === '<' ? comparison < 0 : operator === '<=' ? comparison <= 0 : operator === '==' ? comparison === 0 : operator === '>=' ? comparison >= 0 : comparison > 0;
}

function ruleContext(rule: Rule, options: AnalysisOptions): [boolean, string] {
  if (rule.sourceVersions) {
    if (!options.sourceVersion) return [false, 'versão de origem não informada'];
    if (!matchesRange(options.sourceVersion, rule.sourceVersions)) return [false, 'versão de origem fora do intervalo da regra'];
  }
  if (rule.targetVersions && !matchesRange(options.targetVersion, rule.targetVersions)) return [false, 'versão de destino fora do intervalo da regra'];
  const selectedLoaders = [options.sourceLoader, options.targetLoader].filter(Boolean).map((item) => item!.toLowerCase());
  if (rule.loaders.length && !rule.loaders.some((loader) => selectedLoaders.includes(loader.toLowerCase()))) return [false, 'loader fora do conjunto da regra'];
  if (rule.appliesTo) {
    for (const [field, operator, expected] of parseLegacyConditions(rule.appliesTo)) {
      const actual = field === 'source' ? options.sourceVersion : options.targetVersion;
      if (!actual) return [false, `versão de ${field} não informada`];
      if (!matchesCondition(actual, operator, expected)) return [false, `condição ${field}${operator}${expected} não satisfeita`];
    }
  }
  return [true, 'aplicável'];
}

export async function analyzeWorkspace(workspaceRoot: string, options: AnalysisOptions, rulesRootOverride?: string): Promise<AnalysisResult> {
  validateVersion(options.targetVersion, '--target-version');
  if (options.sourceVersion) validateVersion(options.sourceVersion, '--source-version');
  const rules = await readRules(workspaceRoot, rulesRootOverride);
  const context = await detectContext(workspaceRoot);
  const textExtensions = new Set(['.java', '.json', '.toml', '.properties', '.gradle', '.kts', '.yaml', '.yml', '.mcmeta', '.txt']);
  const files = (await projectFiles(workspaceRoot)).filter((file) => textExtensions.has(path.extname(file).toLowerCase()));
  const applicable: Rule[] = [];
  const skippedRules: SkippedRule[] = [];
  for (const rule of rules) {
    const [applies, reason] = ruleContext(rule, options);
    if (applies) applicable.push(rule); else skippedRules.push({ rule, reason });
  }
  const findings: Finding[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const seen = new Set<string>();
    const views = new Map<MatchIn, string>();
    for (const rule of applicable) if (!views.has(rule.matchIn)) views.set(rule.matchIn, lexicalView(text, rule.matchIn));
    const fileRules = applicable.filter((rule) => file.endsWith('.java') || rule.matchIn !== 'code');
    for (const rule of fileRules) {
      const view = views.get(rule.matchIn) || lexicalView(text, rule.matchIn);
      for (const pattern of rule.patterns) {
        let regex: RegExp;
        try { regex = new RegExp(pattern, 'g'); }
        catch (error) { throw new Error(`Regex inválida na regra '${rule.id}': ${error instanceof Error ? error.message : String(error)}`); }
        let match: RegExpExecArray | null;
        while ((match = regex.exec(view)) !== null) {
          const start = match.index;
          const line = text.slice(0, start).split('\n').length;
          const lineStart = text.lastIndexOf('\n', start - 1) + 1;
          const lineText = (text.split(/\r?\n/)[line - 1] || '').trim();
          const column = start - lineStart + 1;
          const key = `${rule.id}:${line}:${column}:${match[0]}`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({ rule, file, line, column, lineText, matchedText: match[0], pattern });
          }
          if (match[0].length === 0) regex.lastIndex++;
        }
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.id.localeCompare(b.rule.id));
  return { findings, skippedRules, filesSeen: files.length, rulesLoaded: rules.length, context, options };
}

export function renderMarkdown(result: AnalysisResult, workspaceRoot: string, modName: string): string {
  const value = (input: string): string => input.replace(/`/g, '\\`');
  const confidence = (input: number | undefined): string => input === undefined ? 'Não definida' : `${Math.round(input * 100)}%`;
  const lines: string[] = [
    `# Relatório de Portabilidade — ${modName}`, '',
    `- **Origem analisada:** \`${workspaceRoot}\``,
    `- **Versão de origem:** \`${result.options.sourceVersion || 'não informada'}\``,
    `- **Versão de destino:** \`${result.options.targetVersion}\``,
    `- **Loader de origem:** \`${result.options.sourceLoader || 'não informado'}\``,
    `- **Loader de destino:** \`${result.options.targetLoader || 'não informado'}\``,
    '- **Modo:** somente leitura; nenhum arquivo-fonte foi alterado.', '',
    '## Contexto detectado', '',
    `- **Loader detectado:** \`${result.context.loader || 'não identificado'}\``,
    `- **Java detectado:** \`${result.context.javaVersion || 'não identificado'}\``,
    `- **Mappings:** ${result.context.mappings.join(', ') || 'não identificados'}`,
    `- **Dependências:** ${result.context.dependencies.join(', ') || 'não identificadas'}`, '',
    '## Resumo', '',
    `Foram analisados **${result.filesSeen}** arquivo(s) de código/dados com **${result.rulesLoaded}** regra(s) carregada(s), **${result.skippedRules.length}** regra(s) fora do contexto e **${result.findings.length}** ocorrência(s).`, '',
  ];
  if (!result.findings.length) lines.push('Nenhuma ocorrência foi encontrada pelas regras aplicáveis.', '');
  else {
    lines.push('## Ocorrências', '');
    result.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. \`${finding.rule.id}\``, '',
        `- **Arquivo:** \`${path.relative(workspaceRoot, finding.file)}\``,
        `- **Linha/coluna:** \`${finding.line}:${finding.column}\``,
        `- **Severidade:** ${finding.rule.severity}`,
        `- **Confiança editorial:** ${confidence(finding.rule.confidence)}`,
        `- **Correspondência:** \`${value(finding.matchedText)}\``,
        '- **Código:**', '', `    ${finding.lineText.replace(/\t/g, '    ')}`,
        `- **Problema:** ${finding.rule.issue}`,
        `- **Sugestão:** ${finding.rule.suggestion}`,
        `- **Referências:** ${finding.rule.references.join(', ') || 'não informadas'}`, '');
    });
  }
  if (result.skippedRules.length) {
    lines.push('## Regras não aplicadas por contexto', '');
    for (const item of result.skippedRules) lines.push(`- \`${item.rule.id}\` — ${item.reason}.`);
    lines.push('');
  }
  lines.push('## Limites desta execução', '', 'Este relatório é uma análise estática orientada por padrões. Ele não modifica arquivos, não aplica patches, não executa build e não substitui a revisão humana.', '');
  return lines.join('\n');
}

export { detectContext };
