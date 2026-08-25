import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as yaml from 'js-yaml';

const execFileAsync = promisify(execFile);

export type Loader = 'forge' | 'neoforge' | 'fabric' | 'quilt';
export type MatchIn = 'code' | 'strings' | 'both';
export type SeverityName = 'low' | 'medium' | 'high' | 'info';

export interface VersionRange { minimum?: string; maximum?: string; }
export interface Suggestion {
  type: string;
  old?: string;
  new?: string;
  automatable: boolean;
  automationSafety: string;
}
export interface Evidence { kind: string; description: string; weight: number; }

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
  category: string;
  breakingChange: boolean;
  migrationType?: string;
  replacementApi?: string;
  affectedPackages: string[];
  affectedMethods: string[];
  affectedClasses: string[];
  falsePositivePatterns: string[];
  requiresAst: boolean;
  requiresDependencyCheck: boolean;
  automatable: boolean;
  automationSafety: string;
  introducedIn?: string;
  removedIn?: string;
  deprecatedIn?: string;
  before?: string;
  after?: string;
  suggestionObject?: Suggestion;
  file: string;
}

export interface Suppression { rule: string; file?: string; line?: number; reason: string; }
export interface ProjectConfig {
  sourceVersion?: string;
  sourceLoader?: Loader;
  targetVersion: string;
  targetLoader?: Loader;
  ast: boolean;
  dependencies: boolean;
  failOn: SeverityName;
  suppressions: Suppression[];
  includeExtensions: string[];
  excludeDirectories: string[];
}

export interface JavaSymbol { kind: string; name: string; line: number; column: number; detail: string; }
export interface JavaStructure {
  imports: JavaSymbol[];
  types: JavaSymbol[];
  methods: JavaSymbol[];
  calls: JavaSymbol[];
  annotations: JavaSymbol[];
  parser: 'structural' | 'fallback';
  partial: boolean;
}

export interface Finding {
  rule: Rule;
  file: string;
  line: number;
  column: number;
  lineText: string;
  matchedText: string;
  pattern: string;
  evidences: Evidence[];
  detectionConfidence: number;
  overallConfidence: number;
  suggestionObject?: Suggestion;
  structure?: JavaStructure;
}
export interface SkippedRule { rule: Rule; reason: string; }
export interface DetectedContext {
  loader?: Loader | 'ambiguous';
  javaVersion?: string;
  mappings: string[];
  dependencies: string[];
  evidence: string[];
  minecraftVersion?: string;
  loaderVersion?: string;
  buildSystems: string[];
  gradleVersion?: string;
  gradlePlugins: string[];
  dependencyVersions: string[];
  confidence: number;
}
export interface AnalysisOptions {
  sourceVersion?: string;
  targetVersion: string;
  sourceLoader?: Loader;
  targetLoader?: Loader;
  ast?: boolean;
  dependencies?: boolean;
  suppressions?: Suppression[];
}
export interface AnalysisResult {
  findings: Finding[];
  skippedRules: SkippedRule[];
  filesSeen: number;
  rulesLoaded: number;
  context: DetectedContext;
  options: AnalysisOptions;
  filesByExtension: Record<string, number>;
  severityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  applicableRules: number;
  totalRules: number;
  changedFiles: string[];
  structures: Array<{ file: string; structure: JavaStructure }>;
}

const VERSION_RE = /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/;
const LEGACY_CONDITION_RE = /^(?:(source|target)\s*)?(<=|>=|==|<|>)\s*(\d+(?:\.\d+)+)$/i;
const DEFAULT_EXTENSIONS = ['.java', '.json', '.toml', '.properties', '.gradle', '.kts', '.yaml', '.yml', '.mcmeta', '.txt'];
const DEFAULT_EXCLUDED = ['.git', '.gradle', 'node_modules', 'build', 'out', 'bin', 'dist', '.security-audit', 'reports'];

function stringValue(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null) { if (required) throw new Error(`Campo obrigatório ausente: ${field}.`); return undefined; }
  if (typeof value !== 'string') throw new Error(`O campo '${field}' deve ser texto.`);
  const result = value.trim();
  if (required && !result) throw new Error(`O campo obrigatório '${field}' não pode ser vazio.`);
  return result || undefined;
}
function stringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || !values.length) throw new Error(`O campo '${field}' deve ser texto ou lista de textos.`);
  return values.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`Todos os itens de '${field}' devem ser textos não vazios.`);
    return item.trim();
  });
}
function boolValue(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`O campo '${field}' deve ser booleano.`);
  return value;
}
function versionKey(value: string): number[] {
  const match = /^(\d+(?:\.\d+)*)/.exec(value);
  if (!match) throw new Error(`Versão inválida: '${value}'.`);
  return match[1].split('.').map(Number);
}
function compareVersions(left: string, right: string): number {
  const a = versionKey(left); const b = versionKey(right); const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index] ?? 0; const rightPart = b[index] ?? 0;
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
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`O campo '${field}' deve ser texto ou objeto com min/max.`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== 'min' && key !== 'max');
  if (unknown.length) throw new Error(`Campos desconhecidos em '${field}': ${unknown.join(', ')}.`);
  const minimum = stringValue(record.min, `${field}.min`); const maximum = stringValue(record.max, `${field}.max`);
  if (!minimum && !maximum) throw new Error(`O intervalo '${field}' precisa de min ou max.`);
  if (minimum) validateVersion(minimum, `${field}.min`); if (maximum) validateVersion(maximum, `${field}.max`);
  if (minimum && maximum && compareVersions(minimum, maximum) > 0) throw new Error(`O intervalo '${field}' possui min maior que max.`);
  return { minimum, maximum };
}
function parseConditions(expression: string): Array<[string, string, string]> {
  return expression.split(/\s+AND\s+/i).map((part) => {
    const match = LEGACY_CONDITION_RE.exec(part.trim());
    if (!match) throw new Error("Expressão 'applies_to' inválida. Use, por exemplo, 'source<1.13 AND target>=1.13'.");
    return [match[1]?.toLowerCase() || 'target', match[2], match[3]];
  });
}
function parseSuggestion(value: unknown, ruleId: string): Suggestion | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`A sugestão da regra '${ruleId}' deve ser um objeto.`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !['type', 'old', 'new', 'automatable', 'automation_safety'].includes(key));
  if (unknown.length) throw new Error(`Campos desconhecidos na sugestão '${ruleId}': ${unknown.join(', ')}.`);
  return {
    type: stringValue(record.type, `suggestion.${ruleId}.type`, true)!,
    old: stringValue(record.old, `suggestion.${ruleId}.old`),
    new: stringValue(record.new, `suggestion.${ruleId}.new`),
    automatable: boolValue(record.automatable, `suggestion.${ruleId}.automatable`),
    automationSafety: stringValue(record.automation_safety, `suggestion.${ruleId}.automation_safety`) || 'manual_review',
  };
}
function parseRule(value: unknown, index: number, file: string): Rule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}, regra #${index}: a regra deve ser um objeto YAML.`);
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id, `rules[${index}].id`, true)!;
  const patterns = stringArray(record.patterns ?? record.pattern, `rules[${index}].pattern`);
  if (!patterns.length) throw new Error(`${file}, regra '${id}': informe pattern ou patterns.`);
  const appliesTo = stringValue(record.applies_to, `rules[${index}].applies_to`); if (appliesTo) parseConditions(appliesTo);
  const confidenceValue = record.confidence;
  if (confidenceValue !== undefined && confidenceValue !== null && (typeof confidenceValue !== 'number' || !Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)) throw new Error(`${file}, regra '${id}': confidence deve ser um número entre 0 e 1.`);
  const severity = (stringValue(record.severity, `rules[${index}].severity`) || 'info').toLowerCase();
  if (!['low', 'medium', 'high', 'info'].includes(severity)) throw new Error(`${file}, regra '${id}': severity inválida.`);
  const matchIn = stringValue(record.match_in, `rules[${index}].match_in`) || 'code';
  if (!['code', 'strings', 'both'].includes(matchIn)) throw new Error(`${file}, regra '${id}': match_in inválido.`);
  const allowed = new Set(['id', 'pattern', 'patterns', 'issue', 'suggestion', 'severity', 'applies_to', 'confidence', 'match_in', 'loader', 'loaders', 'references', 'source_versions', 'target_versions', 'category', 'breaking_change', 'migration_type', 'replacement_api', 'affected_packages', 'affected_methods', 'affected_classes', 'false_positive_patterns', 'requires_ast', 'requires_dependency_check', 'automatable', 'automation_safety', 'introduced_in', 'removed_in', 'deprecated_in', 'before', 'after', 'suggestion_object', 'transformation']);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)); if (unknown.length) throw new Error(`${file}, regra '${id}': campos desconhecidos: ${unknown.join(', ')}.`);
  return {
    id, patterns, issue: stringValue(record.issue, `rules[${index}].issue`) || 'Não informado.', suggestion: stringValue(record.suggestion, `rules[${index}].suggestion`) || 'Não informada.',
    severity: severity as SeverityName, appliesTo, confidence: confidenceValue as number | undefined, references: stringArray(record.references, `rules[${index}].references`), loaders: stringArray(record.loaders ?? record.loader, `rules[${index}].loader`),
    sourceVersions: parseRange(record.source_versions, `rules[${index}].source_versions`), targetVersions: parseRange(record.target_versions, `rules[${index}].target_versions`), matchIn: matchIn as MatchIn,
    category: (stringValue(record.category, `rules[${index}].category`) || 'UNCATEGORIZED').toUpperCase(), breakingChange: boolValue(record.breaking_change, `rules[${index}].breaking_change`), migrationType: stringValue(record.migration_type, `rules[${index}].migration_type`), replacementApi: stringValue(record.replacement_api, `rules[${index}].replacement_api`),
    affectedPackages: stringArray(record.affected_packages, `rules[${index}].affected_packages`), affectedMethods: stringArray(record.affected_methods, `rules[${index}].affected_methods`), affectedClasses: stringArray(record.affected_classes, `rules[${index}].affected_classes`), falsePositivePatterns: stringArray(record.false_positive_patterns, `rules[${index}].false_positive_patterns`),
    requiresAst: boolValue(record.requires_ast, `rules[${index}].requires_ast`), requiresDependencyCheck: boolValue(record.requires_dependency_check, `rules[${index}].requires_dependency_check`), automatable: boolValue(record.automatable, `rules[${index}].automatable`), automationSafety: stringValue(record.automation_safety, `rules[${index}].automation_safety`) || 'manual_review',
    introducedIn: stringValue(record.introduced_in, `rules[${index}].introduced_in`), removedIn: stringValue(record.removed_in, `rules[${index}].removed_in`), deprecatedIn: stringValue(record.deprecated_in, `rules[${index}].deprecated_in`), before: stringValue(record.before, `rules[${index}].before`), after: stringValue(record.after, `rules[${index}].after`), suggestionObject: parseSuggestion(record.suggestion_object ?? record.transformation, id), file,
  };
}
async function yamlFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !DEFAULT_EXCLUDED.includes(entry.name)) await walk(path.join(current, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.yaml')) result.push(path.join(current, entry.name));
    }
  }
  await walk(root); return result;
}
export async function readRules(workspaceRoot: string, rulesRootOverride?: string): Promise<Rule[]> {
  const ruleRoot = rulesRootOverride || path.join(workspaceRoot, 'knowledge-base', 'rules');
  let files: string[];
  try { const stat = await fs.stat(ruleRoot); files = stat.isDirectory() ? await yamlFiles(ruleRoot) : [ruleRoot]; }
  catch { const legacy = path.join(workspaceRoot, 'knowledge-base', 'rules.yaml'); try { await fs.access(legacy); files = [legacy]; } catch { throw new Error(`Base de regras não encontrada em '${ruleRoot}'.`); } }
  const rules: Rule[] = []; const ids = new Set<string>();
  for (const file of files) {
    let document: unknown;
    try { document = yaml.load(await fs.readFile(file, 'utf8')); } catch (error) { throw new Error(`YAML inválido em '${file}': ${error instanceof Error ? error.message : String(error)}`); }
    if (document === null || document === undefined) continue;
    let values: unknown = document;
    if (typeof document === 'object' && !Array.isArray(document)) {
      const record = document as Record<string, unknown>; const keys = Object.keys(record);
      if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'rules')) throw new Error(`A raiz de '${file}' deve ser uma lista ou conter somente 'rules'.`);
      values = record.rules;
    }
    if (!Array.isArray(values)) throw new Error(`A raiz de '${file}' deve ser uma lista de regras.`);
    values.forEach((value, index) => { const rule = parseRule(value, index + 1, path.relative(workspaceRoot, file)); if (ids.has(rule.id)) throw new Error(`ID de regra duplicado: '${rule.id}'.`); ids.add(rule.id); rules.push(rule); });
  }
  return rules;
}

async function projectFiles(root: string, config?: ProjectConfig): Promise<string[]> {
  const extensions = new Set(config?.includeExtensions || DEFAULT_EXTENSIONS); const excluded = new Set(config?.excludeDirectories || DEFAULT_EXCLUDED); const result: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries; try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) { if (!excluded.has(entry.name)) await walk(path.join(current, entry.name)); }
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(path.join(current, entry.name));
    }
  }
  await walk(root); return result;
}
async function readTexts(root: string): Promise<Map<string, string>> {
  const files = await projectFiles(root); const texts = new Map<string, string>();
  for (const file of files) { try { texts.set(file, (await fs.readFile(file, 'utf8')).slice(0, 1_000_000)); } catch { /* arquivo ilegível é ignorado */ } }
  return texts;
}
function findFirst(texts: Map<string, string>, patterns: RegExp[]): { value?: string; evidence?: string } {
  for (const [file, text] of texts) for (const pattern of patterns) { const match = pattern.exec(text); if (match) return { value: match[1], evidence: `${match[1]}: ${path.basename(file)}` }; }
  return {};
}
export async function detectContext(root: string): Promise<DetectedContext> {
  const texts = await readTexts(root); const loaders: Loader[] = []; const evidence: string[] = [];
  const markers: Record<Loader, string[]> = { forge: ['mods.toml', 'net.minecraftforge', 'forgegradle'], neoforge: ['neoforge.mods.toml', 'net.neoforged', 'neogradle'], fabric: ['fabric.mod.json', 'net.fabricmc', 'fabric-loom'], quilt: ['quilt.mod.json', 'org.quiltmc', 'quilt-loom'] };
  for (const [loader, loaderMarkers] of Object.entries(markers) as Array<[Loader, string[]]>) {
    const match = [...texts.entries()].find(([file, text]) => loaderMarkers.some((marker) => path.basename(file).toLowerCase() === marker.toLowerCase() || text.toLowerCase().includes(marker.toLowerCase())));
    if (match) { loaders.push(loader); evidence.push(`${loader}: ${path.relative(root, match[0])}`); }
  }
  const java = findFirst(texts, [/languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*(\d+)\s*\)/i, /(?:sourceCompatibility|targetCompatibility|javaVersion|java_version)\s*[=:]\s*['"]?(\d+)/i]);
  if (java.evidence) evidence.push(`java ${java.evidence}`);
  const minecraft = findFirst(texts, [/(?:minecraft_version|minecraftVersion|minecraft)\s*[=:]\s*['"]?([0-9]+(?:\.[0-9]+)+)/i, /net\.minecraft:minecraft:([0-9]+(?:\.[0-9]+)+)/i]);
  if (minecraft.evidence) evidence.push(`minecraft ${minecraft.evidence}`);
  const gradle = findFirst(texts, [/distributionUrl=.*gradle-([0-9]+(?:\.[0-9]+)+)-/i]);
  if (gradle.evidence) evidence.push(`gradle ${gradle.evidence}`);
  const mappingMarkers: Record<string, string[]> = { yarn: ['yarn'], mojmap: ['mojmap', 'official mappings', 'official_mappings'], srg: ['srg', 'searge'], parchment: ['parchment'] };
  const mappings: string[] = []; for (const [name, items] of Object.entries(mappingMarkers)) { const match = [...texts.entries()].find(([, text]) => items.some((item) => text.toLowerCase().includes(item))); if (match) { mappings.push(name); evidence.push(`mapping ${name}: ${path.relative(root, match[0])}`); } }
  const dependencyMarkers: Record<string, string[]> = { jei: ['jei', 'justenoughitems'], curios: ['curios'], create: ['create'], geckolib: ['geckolib', 'gecko lib'], architectury: ['architectury'], 'cloth-config': ['cloth-config', 'cloth_config'] };
  const dependencies: string[] = []; const dependencyVersions: string[] = [];
  for (const [name, items] of Object.entries(dependencyMarkers)) { const match = [...texts.entries()].find(([, text]) => items.some((item) => new RegExp(`(?<![a-z0-9])${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text))); if (match) { dependencies.push(name); evidence.push(`dependency ${name}: ${path.relative(root, match[0])}`); } }
  for (const text of texts.values()) for (const match of text.matchAll(/([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)/g)) dependencyVersions.push(match[0]);
  const buildSystems: string[] = []; const gradlePlugins: string[] = [];
  for (const [file, text] of texts) { const name = path.basename(file).toLowerCase(); const lower = text.toLowerCase(); if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat'].includes(name)) buildSystems.push(name.startsWith('gradlew') ? 'gradle-wrapper' : 'gradle'); if (lower.includes('fabric-loom')) gradlePlugins.push('fabric-loom'); if (lower.includes('forgegradle')) gradlePlugins.push('forgegradle'); if (lower.includes('neogradle')) gradlePlugins.push('neogradle'); }
  const uniqueEvidence = [...new Set(evidence)];
  return { loader: loaders.length === 1 ? loaders[0] : loaders.length > 1 ? 'ambiguous' : undefined, javaVersion: java.value, mappings: [...new Set(mappings)], dependencies: [...new Set(dependencies)], evidence: uniqueEvidence, minecraftVersion: minecraft.value, loaderVersion: undefined, buildSystems: [...new Set(buildSystems)], gradleVersion: gradle.value, gradlePlugins: [...new Set(gradlePlugins)], dependencyVersions: [...new Set(dependencyVersions)], confidence: Math.min(1, uniqueEvidence.length / 8) };
}
function blank(character: string): string { return character === '\n' ? '\n' : ' '; }
export function lexicalView(text: string, mode: MatchIn): string {
  const keepCode = mode === 'code' || mode === 'both'; const keepStrings = mode === 'strings' || mode === 'both'; const output: string[] = []; let state = 'code'; let index = 0;
  while (index < text.length) {
    const character = text[index]; const two = text.slice(index, index + 2); const three = text.slice(index, index + 3);
    if (state === 'code') { if (two === '//') { output.push('  '); index += 2; state = 'lineComment'; } else if (two === '/*') { output.push('  '); index += 2; state = 'blockComment'; } else if (three === '"""') { output.push(...[...three].map((item) => keepStrings ? item : blank(item))); index += 3; state = 'textBlock'; } else if (character === '"') { output.push(keepStrings ? character : blank(character)); index += 1; state = 'string'; } else if (character === "'") { output.push(keepStrings ? character : blank(character)); index += 1; state = 'char'; } else { output.push(keepCode ? character : blank(character)); index += 1; } }
    else if (state === 'lineComment') { output.push(blank(character)); index += 1; if (character === '\n') state = 'code'; }
    else if (state === 'blockComment') { if (two === '*/') { output.push('  '); index += 2; state = 'code'; } else { output.push(blank(character)); index += 1; } }
    else if (state === 'string' || state === 'char') { output.push(keepStrings ? character : blank(character)); index += 1; if (character === '\\' && index < text.length) { output.push(keepStrings ? text[index] : blank(text[index])); index += 1; } else if ((state === 'string' && character === '"') || (state === 'char' && character === "'")) state = 'code'; }
    else { if (three === '"""') { output.push(...[...three].map((item) => keepStrings ? item : blank(item))); index += 3; state = 'code'; } else { output.push(keepStrings ? character : blank(character)); index += 1; } }
  }
  return output.join('');
}
function lineColumn(text: string, offset: number): { line: number; column: number } { const line = text.slice(0, offset).split(/\r?\n/).length; const start = text.lastIndexOf('\n', offset - 1) + 1; return { line, column: offset - start + 1 }; }
export function parseJava(text: string): JavaStructure {
  const code = lexicalView(text, 'code'); const imports: JavaSymbol[] = []; const types: JavaSymbol[] = []; const methods: JavaSymbol[] = []; const calls: JavaSymbol[] = []; const annotations: JavaSymbol[] = [];
  for (const match of code.matchAll(/\bimport\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$*]*)*)/g)) { const position = lineColumn(text, match.index ?? 0); imports.push({ kind: 'import', name: match[1], ...position, detail: '' }); }
  for (const match of code.matchAll(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([A-Za-z_$][\w$.<>]*))?\s*(?:implements\s+([^\{]+))?/g)) { const position = lineColumn(text, match.index ?? 0); types.push({ kind: 'type', name: match[2], ...position, detail: [match[3] ? `extends ${match[3]}` : '', match[4] ? `implements ${match[4].trim()}` : ''].filter(Boolean).join('; ') }); }
  for (const match of code.matchAll(/\b([A-Z][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)?)\s+[A-Za-z_$][\w$]*\s*(?:=|;)/g)) { const position = lineColumn(text, match.index ?? 0); types.push({ kind: 'type_ref', name: match[1], ...position, detail: '' }); }
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) { const name = match[1]; if (!['if', 'for', 'while', 'switch', 'catch'].includes(name)) { const position = lineColumn(text, match.index ?? 0); calls.push({ kind: 'call', name, ...position, detail: '' }); } }
  for (const match of code.matchAll(/@([A-Za-z_$][\w$.]*)/g)) { const position = lineColumn(text, match.index ?? 0); annotations.push({ kind: 'annotation', name: match[1], ...position, detail: '' }); }
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/g)) { const name = match[1]; if (!['if', 'for', 'while', 'switch', 'catch'].includes(name)) { const position = lineColumn(text, match.index ?? 0); methods.push({ kind: 'method', name, ...position, detail: '' }); } }
  return { imports, types, methods, calls, annotations, parser: 'structural', partial: false };
}
function structureMatches(structure: JavaStructure, pattern: string): JavaSymbol[] { let regex: RegExp; try { regex = new RegExp(pattern); } catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } return [...structure.imports, ...structure.types, ...structure.methods, ...structure.calls, ...structure.annotations].filter((symbol) => regex.test(symbol.name) || regex.test(symbol.detail)); }
function rangeMatches(version: string, range: VersionRange): boolean { return (!range.minimum || compareVersions(version, range.minimum) >= 0) && (!range.maximum || compareVersions(version, range.maximum) <= 0); }
function conditionMatches(version: string, operator: string, expected: string): boolean { const comparison = compareVersions(version, expected); return operator === '<' ? comparison < 0 : operator === '<=' ? comparison <= 0 : operator === '==' ? comparison === 0 : operator === '>=' ? comparison >= 0 : comparison > 0; }
function ruleContext(rule: Rule, options: AnalysisOptions): [boolean, string] {
  if (rule.sourceVersions) { if (!options.sourceVersion) return [false, 'versão de origem não informada']; if (!rangeMatches(options.sourceVersion, rule.sourceVersions)) return [false, 'versão de origem fora do intervalo da regra']; }
  if (rule.targetVersions && !rangeMatches(options.targetVersion, rule.targetVersions)) return [false, 'versão de destino fora do intervalo da regra'];
  const loaders = [options.sourceLoader, options.targetLoader].filter(Boolean).map((item) => item!.toLowerCase()); if (rule.loaders.length && !rule.loaders.some((loader) => loaders.includes(loader.toLowerCase()))) return [false, 'loader fora do conjunto da regra'];
  if (rule.appliesTo) for (const [field, operator, expected] of parseConditions(rule.appliesTo)) { const actual = field === 'source' ? options.sourceVersion : options.targetVersion; if (!actual) return [false, `versão de ${field} não informada`]; if (!conditionMatches(actual, operator, expected)) return [false, `condição ${field}${operator}${expected} não satisfeita`]; }
  return [true, 'aplicável'];
}
function evidenceFor(rule: Rule, pattern: string, structure?: JavaStructure, context?: DetectedContext, dependenciesEnabled = true): { evidences: Evidence[]; detection: number } {
  const evidences: Evidence[] = [{ kind: 'lexical', description: `Padrão '${pattern}' encontrado no conteúdo analisado.`, weight: 0.35 }]; let detection = 0.35;
  if (structure) { const structural = structureMatches(structure, pattern); if (structural.length) { evidences.push({ kind: 'ast', description: `Símbolo estrutural '${structural[0].name}' confirmado.`, weight: 0.30 }); detection += 0.30; } else if (rule.requiresAst) { evidences.push({ kind: 'ast', description: 'A ocorrência não foi confirmada estruturalmente.', weight: -0.15 }); detection -= 0.15; } }
  if (rule.requiresDependencyCheck) { if (dependenciesEnabled && context?.dependencies.length) { evidences.push({ kind: 'dependency', description: `Dependência(s) detectada(s): ${context.dependencies.join(', ')}.`, weight: 0.10 }); detection += 0.10; } else { evidences.push({ kind: 'dependency', description: 'Nenhuma dependência conhecida foi detectada; a ocorrência exige revisão humana.', weight: -0.05 }); detection -= 0.05; } }
  if (rule.references.length) { evidences.push({ kind: 'reference', description: `${rule.references.length} referência(s) editorial(is).`, weight: 0.10 }); detection += 0.10; }
  return { evidences, detection: Math.max(0, Math.min(1, detection)) };
}
function suppressed(finding: Finding, root: string, suppressions: Suppression[]): boolean { const relative = path.relative(root, finding.file).replaceAll(path.sep, '/'); return suppressions.some((item) => (item.rule === '*' || item.rule === finding.rule.id) && (!item.file || item.file === relative || item.file === path.basename(finding.file)) && (!item.line || item.line === finding.line)); }
export async function loadProjectConfig(root: string, explicit?: string): Promise<ProjectConfig> {
  let configPath = explicit; if (!configPath) for (const candidate of ['.mod-port-toolkit.yml', '.mod-port-toolkit.yaml']) { const full = path.join(root, candidate); try { await fs.access(full); configPath = full; break; } catch { /* continua */ } }
  let raw: Record<string, unknown> = {}; if (configPath) { const document = yaml.load(await fs.readFile(configPath, 'utf8')); if (document && typeof document === 'object' && !Array.isArray(document)) raw = document as Record<string, unknown>; else if (document) throw new Error('A configuração do projeto deve ser um objeto YAML.'); }
  const ignorePath = path.join(root, '.mod-port-toolkit-ignore.yml');
  try {
    const ignoreDocument = yaml.load(await fs.readFile(ignorePath, 'utf8'));
    if (!ignoreDocument || typeof ignoreDocument !== 'object' || Array.isArray(ignoreDocument)) throw new Error('A configuração de suppressions deve ser um objeto YAML.');
    const external = (ignoreDocument as Record<string, unknown>).ignore;
    if (!Array.isArray(external)) throw new Error("'ignore' no arquivo separado deve ser uma lista.");
    raw = { ...raw, ignore: [...(Array.isArray(raw.ignore) ? raw.ignore : []), ...external] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const section = (name: string): Record<string, unknown> => { const value = raw[name]; if (value === undefined) return {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`A seção '${name}' deve ser um objeto.`); return value as Record<string, unknown>; };
  const source = section('source'); const target = section('target'); const analysis = section('analysis'); const severity = section('severity');
  const sourceVersion = stringValue(source.minecraft, 'source.minecraft'); const targetVersion = stringValue(target.minecraft, 'target.minecraft') || '1.21.1'; validateVersion(targetVersion, 'target.minecraft'); if (sourceVersion) validateVersion(sourceVersion, 'source.minecraft');
  const validLoader = (value: unknown, field: string): Loader | undefined => { const result = stringValue(value, field); if (result && !['forge', 'neoforge', 'fabric', 'quilt'].includes(result)) throw new Error(`'${field}' deve ser forge, neoforge, fabric ou quilt.`); return result as Loader | undefined; };
  const rawIgnore = raw.ignore ?? []; if (!Array.isArray(rawIgnore)) throw new Error("'ignore' deve ser uma lista."); const suppressions = rawIgnore.map((item, index) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`ignore[${index + 1}] deve ser um objeto.`); const value = item as Record<string, unknown>; const rule = stringValue(value.rule, `ignore[${index + 1}].rule`, true)!; const reason = stringValue(value.reason, `ignore[${index + 1}].reason`, true)!; const line = value.line === undefined ? undefined : Number(value.line); if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new Error(`ignore[${index + 1}].line inválida.`); return { rule, file: stringValue(value.file, `ignore[${index + 1}].file`), line, reason }; });
  const failOn = (stringValue(severity.fail_on, 'severity.fail_on') || 'high') as SeverityName; if (!['info', 'low', 'medium', 'high'].includes(failOn)) throw new Error('severity.fail_on inválido.');
  const configuredExtensions = stringArray(raw.include_extensions, 'include_extensions').map((item) => item.startsWith('.') ? item : `.${item}`);
  const configuredExcludes = stringArray(raw.exclude_directories, 'exclude_directories');
  return { sourceVersion, sourceLoader: validLoader(source.loader, 'source.loader'), targetVersion, targetLoader: validLoader(target.loader, 'target.loader'), ast: boolValue(analysis.ast, 'analysis.ast', true), dependencies: boolValue(analysis.dependencies, 'analysis.dependencies', true), failOn, suppressions, includeExtensions: configuredExtensions.length ? configuredExtensions : DEFAULT_EXTENSIONS, excludeDirectories: configuredExcludes.length ? configuredExcludes : DEFAULT_EXCLUDED };
}
export async function gitChangedFiles(root: string, range?: string): Promise<string[]> { try { const args = ['-C', root, 'diff', '--name-only']; if (range) args.push(range); const result = await execFileAsync('git', args, { timeout: 30_000 }); return result.stdout.split(/\r?\n/).filter(Boolean); } catch { return []; } }
export async function gitCompare(root: string, base: string, head: string): Promise<Array<[string, string]>> { try { const result = await execFileAsync('git', ['-C', root, 'diff', '--name-status', `${base}..${head}`], { timeout: 30_000 }); return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [status, ...file] = line.split('\t'); return [status, file.join('\t')] as [string, string]; }); } catch (error) { throw new Error(`Não foi possível comparar Git: ${error instanceof Error ? error.message : String(error)}`); } }

export async function analyzeWorkspace(workspaceRoot: string, options: AnalysisOptions, rulesRootOverride?: string): Promise<AnalysisResult> {
  validateVersion(options.targetVersion, '--target-version'); if (options.sourceVersion) validateVersion(options.sourceVersion, '--source-version');
  const config = await loadProjectConfig(workspaceRoot); const effectiveOptions: AnalysisOptions = { ...options, ast: options.ast ?? config.ast, dependencies: options.dependencies ?? config.dependencies, suppressions: options.suppressions ?? config.suppressions };
  const rules = await readRules(workspaceRoot, rulesRootOverride); const context = await detectContext(workspaceRoot); const selectedFiles = await projectFiles(workspaceRoot, config); const applicable: Rule[] = []; const skippedRules: SkippedRule[] = [];
  for (const rule of rules) { let [applies, reason] = ruleContext(rule, effectiveOptions); if (applies && rule.requiresAst && effectiveOptions.ast === false) { applies = false; reason = 'análise AST desabilitada'; } if (applies && rule.requiresDependencyCheck && effectiveOptions.dependencies === false) { applies = false; reason = 'verificação de dependências desabilitada'; } if (applies) applicable.push(rule); else skippedRules.push({ rule, reason }); }
  const findings: Finding[] = []; const structures: Array<{ file: string; structure: JavaStructure }> = []; const filesByExtension: Record<string, number> = {};
  for (const file of selectedFiles) {
    filesByExtension[path.extname(file).toLowerCase() || '[sem extensão]'] = (filesByExtension[path.extname(file).toLowerCase() || '[sem extensão]'] || 0) + 1;
    const text = await fs.readFile(file, 'utf8'); const structure = path.extname(file).toLowerCase() === '.java' && effectiveOptions.ast !== false ? parseJava(text) : undefined; if (structure) structures.push({ file, structure });
    const lines = text.split(/\r?\n/); const seen = new Set<string>();
    for (const rule of applicable) {
      if (path.extname(file).toLowerCase() === '.java' && rule.matchIn === 'code' && !structure && rule.requiresAst) continue;
      const view = lexicalView(text, rule.matchIn); for (const pattern of rule.patterns) { let regex: RegExp; try { regex = new RegExp(pattern, 'g'); } catch (error) { throw new Error(`Regex inválida na regra '${rule.id}': ${error instanceof Error ? error.message : String(error)}`); }
        let match: RegExpExecArray | null; while ((match = regex.exec(view)) !== null) { const position = lineColumn(text, match.index); const lineText = (lines[position.line - 1] || '').trim(); if (rule.falsePositivePatterns.some((item) => new RegExp(item).test(lineText))) { if (!match[0].length) regex.lastIndex += 1; continue; } const key = `${rule.id}:${position.line}:${position.column}:${match[0]}`; if (!seen.has(key)) { const evidence = evidenceFor(rule, pattern, structure, context, effectiveOptions.dependencies !== false); const overall = Math.max(0, Math.min(1, (rule.confidence ?? 0.5) * 0.55 + evidence.detection * 0.45)); const finding: Finding = { rule, file, line: position.line, column: position.column, lineText, matchedText: match[0], pattern, evidences: evidence.evidences, detectionConfidence: evidence.detection, overallConfidence: overall, suggestionObject: rule.suggestionObject, structure }; if (!suppressed(finding, workspaceRoot, effectiveOptions.suppressions || [])) findings.push(finding); seen.add(key); } if (!match[0].length) regex.lastIndex += 1; }
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.id.localeCompare(b.rule.id)); const severityCounts: Record<string, number> = {}; const categoryCounts: Record<string, number> = {}; for (const finding of findings) { severityCounts[finding.rule.severity] = (severityCounts[finding.rule.severity] || 0) + 1; categoryCounts[finding.rule.category] = (categoryCounts[finding.rule.category] || 0) + 1; }
  return { findings, skippedRules, filesSeen: selectedFiles.length, rulesLoaded: rules.length, context, options: effectiveOptions, filesByExtension, severityCounts, categoryCounts, applicableRules: applicable.length, totalRules: rules.length, changedFiles: await gitChangedFiles(workspaceRoot), structures };
}
function escaped(value: string): string { return value.replace(/`/g, '\\`'); }
export function renderMarkdown(result: AnalysisResult, workspaceRoot: string, modName: string): string {
  const lines: string[] = [`# MOD PORT REPORT — ${modName}`, '', '> Nenhum problema conhecido encontrado não significa compatibilidade total. Este relatório representa apenas a cobertura das regras aplicáveis.', '', '## Contexto', '', `- **Origem:** \`${result.options.sourceVersion || 'não informada'}\` (${result.options.sourceLoader || 'não informado'})`, `- **Destino:** \`${result.options.targetVersion}\` (${result.options.targetLoader || 'não informado'})`, `- **Loader detectado:** \`${result.context.loader || 'não identificado'}\``, `- **Minecraft detectado:** \`${result.context.minecraftVersion || 'não identificado'}\``, `- **Java detectado:** \`${result.context.javaVersion || 'não identificado'}\``, `- **Mappings:** ${result.context.mappings.join(', ') || 'não identificados'}`, `- **Build systems:** ${result.context.buildSystems.join(', ') || 'não identificados'}`, `- **Dependências:** ${result.context.dependencies.join(', ') || 'não identificadas'}`, '', '## Resumo', '', `Foram analisados **${result.filesSeen}** arquivo(s), com **${result.totalRules}** regra(s) carregada(s), **${result.applicableRules}** aplicável(is), **${result.skippedRules.length}** ignorada(s) por contexto e **${result.findings.length}** ocorrência(s) após suppressions.`, `Cobertura conhecida da base: **${result.totalRules ? Math.round((result.applicableRules / result.totalRules) * 100) : 0}%** das regras carregadas foram aplicáveis.`, '', '### Severidade', '', '| Severidade | Quantidade |', '|---|---:|'];
  for (const severity of ['high', 'medium', 'low', 'info']) lines.push(`| \`${severity}\` | ${result.severityCounts[severity] || 0} |`);
  lines.push('', '### Categorias', '', '| Categoria | Quantidade |', '|---|---:|'); for (const [category, count] of Object.entries(result.categoryCounts).sort()) lines.push(`| \`${category}\` | ${count} |`);
  lines.push('', '## Evidências e sugestões', ''); if (!result.findings.length) lines.push('Nenhuma ocorrência foi encontrada pelas regras aplicáveis. Isso não constitui prova de compatibilidade.', '');
  result.findings.forEach((finding, index) => { const relative = path.relative(workspaceRoot, finding.file).replaceAll(path.sep, '/'); lines.push(`### ${index + 1}. \`${finding.rule.id}\` — ${finding.rule.category}`, '', `- **Arquivo:** \`${relative}\``, `- **Linha/coluna:** \`${finding.line}:${finding.column}\``, `- **Severidade:** \`${finding.rule.severity}\``, `- **Confiança editorial:** \`${finding.rule.confidence === undefined ? 'não definida' : `${Math.round(finding.rule.confidence * 100)}%`}\``, `- **Confiança da detecção:** \`${Math.round(finding.detectionConfidence * 100)}%\``, `- **Confiança geral:** \`${Math.round(finding.overallConfidence * 100)}%\``, `- **Correspondência:** \`${escaped(finding.matchedText)}\``, `- **Código:** \`${escaped(finding.lineText)}\``, `- **Problema:** ${finding.rule.issue}`, `- **Sugestão:** ${finding.rule.suggestion}`, `- **Migration type:** \`${finding.rule.migrationType || 'manual_review'}\``, `- **Replacement API:** \`${finding.rule.replacementApi || 'não definida'}\``, `- **Automatizável:** \`${finding.rule.automatable}\`; segurança: \`${finding.rule.automationSafety}\``, ...(finding.suggestionObject ? [`- **Sugestão estruturada:** tipo \`${finding.suggestionObject.type}\`, antes \`${escaped(finding.suggestionObject.old || 'não definido')}\`, depois \`${escaped(finding.suggestionObject.new || 'não definido')}\``] : []), '- **Evidências:**', ...finding.evidences.map((evidence) => `  - \`${evidence.kind}\`: ${evidence.description} (${evidence.weight >= 0 ? '+' : ''}${evidence.weight.toFixed(2)})`), `- **Referências:** ${finding.rule.references.join(', ') || 'não informadas'}`, ''); });
  lines.push('## Regras ignoradas por contexto', '', ...result.skippedRules.map((item) => `- \`${item.rule.id}\` — ${item.reason}.`), ...(result.skippedRules.length ? [''] : ['Nenhuma regra foi ignorada por contexto.', '']), '## Suppressions', '', ...(result.options.suppressions?.map((item) => `- \`${item.rule}\` em \`${item.file || '*'}\` linha \`${item.line || '*'}\` — ${item.reason}`) || ['Nenhuma suppression configurada.']), '', '## Limitações', '', 'A análise é estática, não executa build, Gradle, Java do mod ou scripts do projeto, não aplica patches e não substitui revisão humana. A integração Git é somente leitura.', '');
  return lines.join('\n');
}
export function coverageReport(result: AnalysisResult): Record<string, unknown> { return { totalRules: result.totalRules, applicableRules: result.applicableRules, knownRuleCoverage: result.totalRules ? Number((result.applicableRules / result.totalRules).toFixed(4)) : 0, findings: result.findings.length, byCategory: result.categoryCounts, bySeverity: result.severityCounts, filesSeen: result.filesSeen }; }
