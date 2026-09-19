"""Orquestração de análise de um projeto de mod, sem build e somente leitura."""

from __future__ import annotations

import re
import shutil
import subprocess  # nosec B404 - usado somente para consultas Git sem shell
from functools import lru_cache
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import yaml

try:
    from .context import ProjectContext, detect_context
    from .scan import (
        Evidence,
        Finding,
        Rule,
        ScanResult,
        SkippedRule,
        ToolkitError,
        _evidence_for_finding,
        _lexical_view,
        _rule_context,
        _validate_version,
        read_rules,
        render_report,
        scan,
    )
except ImportError:  # execução direta: python scanner/scan.py audit
    from context import ProjectContext, detect_context
    from scan import (
        Evidence,
        Finding,
        Rule,
        ScanResult,
        SkippedRule,
        ToolkitError,
        _evidence_for_finding,
        _lexical_view,
        _rule_context,
        _validate_version,
        read_rules,
        render_report,
        scan,
    )

TEXT_EXTENSIONS = {
    ".java", ".json", ".toml", ".properties", ".gradle", ".kts", ".yaml", ".yml", ".mcmeta", ".txt",
}
IGNORED_DIRECTORIES = {".git", ".gradle", "node_modules", "build", "out", "bin", "dist", ".security-audit", "reports"}


@lru_cache(maxsize=512)
def _compiled_regex(pattern: str) -> re.Pattern[str]:
    """Compila padrões uma vez por processo, mantendo a análise somente leitura."""
    try:
        return re.compile(pattern)
    except re.error as exc:
        raise ToolkitError(f"Regex inválida na regra: {exc}") from exc


def _line_offsets(text: str) -> list[int]:
    """Retorna offsets de início de linha para localizar achados em O(log n)."""
    return [0, *[index + 1 for index, char in enumerate(text) if char == "\n"]]


def _position(offsets: list[int], offset: int) -> tuple[int, int]:
    import bisect
    line_index = bisect.bisect_right(offsets, offset) - 1
    return line_index + 1, offset - offsets[line_index] + 1


@dataclass(frozen=True)
class Suppression:
    rule: str
    file: str | None
    line: int | None
    reason: str


@dataclass(frozen=True)
class ProjectConfig:
    source_version: str | None
    source_loader: str | None
    target_version: str
    target_loader: str | None
    ast: bool
    dependencies: bool
    fail_on: str
    suppressions: tuple[Suppression, ...] = ()
    include_extensions: tuple[str, ...] = tuple(sorted(TEXT_EXTENSIONS))
    excluded_directories: tuple[str, ...] = tuple(sorted(IGNORED_DIRECTORIES))


@dataclass(frozen=True)
class WorkspaceResult:
    findings: tuple[Finding, ...]
    skipped_rules: tuple[SkippedRule, ...]
    context: ProjectContext
    config: ProjectConfig
    files_seen: int
    files_by_extension: dict[str, int]
    structures: tuple[Any, ...]
    changed_files: tuple[str, ...] = ()
    severity_counts: dict[str, int] = field(default_factory=dict)
    category_counts: dict[str, int] = field(default_factory=dict)
    applicable_rules: int = 0
    total_rules: int = 0

    @property
    def known_rule_coverage(self) -> float:
        if not self.total_rules:
            return 0.0
        return self.applicable_rules / self.total_rules


def _as_mapping(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ToolkitError(f"O campo '{field_name}' deve ser um objeto.")
    return value


def _as_bool_config(value: Any, field_name: str, default: bool) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ToolkitError(f"O campo '{field_name}' deve ser booleano.")
    return value


def _as_string_list(value: Any, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ToolkitError(f"O campo '{field_name}' deve ser uma lista de textos não vazios.")
    return tuple(item.strip() for item in value)


def load_project_config(root: Path, config_path: Path | None = None) -> ProjectConfig:
    path = config_path
    if path is None:
        for candidate in (root / ".mod-port-toolkit.yml", root / ".mod-port-toolkit.yaml"):
            if candidate.exists():
                path = candidate
                break
    raw: dict[str, Any] = {}
    if path is not None:
        try:
            document = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
            raise ToolkitError(f"Não foi possível ler a configuração '{path}': {exc}") from exc
        raw = _as_mapping(document, "raiz")
    ignore_file = root / ".mod-port-toolkit-ignore.yml"
    if ignore_file.exists() and (path is None or ignore_file != path):
        try:
            ignore_document = yaml.safe_load(ignore_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
            raise ToolkitError(f"Não foi possível ler a configuração de suppressions '{ignore_file}': {exc}") from exc
        ignore_mapping = _as_mapping(ignore_document, "raiz de suppressions")
        extra_ignore_root = set(ignore_mapping) - {"ignore"}
        if extra_ignore_root:
            raise ToolkitError(f"Campos desconhecidos na configuração de suppressions: {', '.join(sorted(extra_ignore_root))}.")
        external_ignore = ignore_mapping.get("ignore", [])
        if not isinstance(external_ignore, list):
            raise ToolkitError("'ignore' no arquivo separado deve ser uma lista.")
        raw = dict(raw)
        raw["ignore"] = list(raw.get("ignore", [])) + list(external_ignore)
    allowed_root = {"source", "target", "analysis", "severity", "ignore", "include_extensions", "exclude_directories"}
    unknown = set(raw) - allowed_root
    if unknown:
        raise ToolkitError(f"Campos desconhecidos na configuração: {', '.join(sorted(unknown))}.")

    source = _as_mapping(raw.get("source"), "source")
    target = _as_mapping(raw.get("target"), "target")
    analysis = _as_mapping(raw.get("analysis"), "analysis")
    severity = _as_mapping(raw.get("severity"), "severity")
    for section, allowed in {
        "source": {"minecraft", "loader"},
        "target": {"minecraft", "loader"},
        "analysis": {"ast", "dependencies"},
        "severity": {"fail_on"},
    }.items():
        current = _as_mapping(raw.get(section), section)
        extra = set(current) - allowed
        if extra:
            raise ToolkitError(f"Campos desconhecidos em '{section}': {', '.join(sorted(extra))}.")

    source_version = source.get("minecraft")
    target_version = target.get("minecraft", "1.21.1")
    for value, name in ((source_version, "source.minecraft"), (target_version, "target.minecraft")):
        if value is not None:
            if not isinstance(value, str):
                raise ToolkitError(f"'{name}' deve ser texto.")
            _validate_version(value, name)
    if not isinstance(target_version, str):
        raise ToolkitError("'target.minecraft' deve ser texto.")
    target_loader = target.get("loader")
    source_loader = source.get("loader")
    for value, name in ((source_loader, "source.loader"), (target_loader, "target.loader")):
        if value is not None and (not isinstance(value, str) or value.casefold() not in {"forge", "neoforge", "fabric", "quilt"}):
            raise ToolkitError(f"'{name}' deve ser forge, neoforge, fabric ou quilt.")

    fail_on = severity.get("fail_on", "high")
    if not isinstance(fail_on, str) or fail_on not in {"info", "low", "medium", "high"}:
        raise ToolkitError("'severity.fail_on' deve ser info, low, medium ou high.")

    suppressions: list[Suppression] = []
    raw_ignore = raw.get("ignore", [])
    if not isinstance(raw_ignore, list):
        raise ToolkitError("'ignore' deve ser uma lista.")
    for index, item in enumerate(raw_ignore, start=1):
        item = _as_mapping(item, f"ignore[{index}]")
        extra = set(item) - {"rule", "file", "line", "reason"}
        if extra:
            raise ToolkitError(f"Campos desconhecidos em ignore[{index}]: {', '.join(sorted(extra))}.")
        rule = item.get("rule")
        reason = item.get("reason")
        if not isinstance(rule, str) or not rule.strip() or not isinstance(reason, str) or not reason.strip():
            raise ToolkitError(f"ignore[{index}] exige rule e reason.")
        line = item.get("line")
        if line is not None and (isinstance(line, bool) or not isinstance(line, int) or line < 1):
            raise ToolkitError(f"ignore[{index}].line deve ser um inteiro positivo.")
        file_value = item.get("file")
        if file_value is not None and (not isinstance(file_value, str) or not file_value.strip()):
            raise ToolkitError(f"ignore[{index}].file deve ser texto não vazio.")
        suppressions.append(Suppression(rule.strip(), file_value.strip() if isinstance(file_value, str) else None, line, reason.strip()))

    include = _as_string_list(raw.get("include_extensions"), "include_extensions") or tuple(sorted(TEXT_EXTENSIONS))
    include = tuple(ext if ext.startswith(".") else f".{ext}" for ext in include)
    excluded = _as_string_list(raw.get("exclude_directories"), "exclude_directories") or tuple(sorted(IGNORED_DIRECTORIES))
    return ProjectConfig(
        source_version=source_version,
        source_loader=source_loader,
        target_version=target_version,
        target_loader=target_loader,
        ast=_as_bool_config(analysis.get("ast"), "analysis.ast", True),
        dependencies=_as_bool_config(analysis.get("dependencies"), "analysis.dependencies", True),
        fail_on=fail_on,
        suppressions=tuple(suppressions),
        include_extensions=include,
        excluded_directories=excluded,
    )


def project_files(root: Path, config: ProjectConfig) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix.casefold() in config.include_extensions else []
    if not root.is_dir():
        raise ToolkitError(f"Workspace não encontrado: {root}")
    excluded = set(config.excluded_directories)
    return sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() in config.include_extensions and not excluded.intersection(path.parts)
    )


def _read_source(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ToolkitError(f"Não foi possível ler '{path}': {exc}") from exc


def _text_findings(
    path: Path,
    root: Path,
    text: str,
    rules: Iterable[Rule],
    options: ProjectConfig,
    project_context: ProjectContext,
) -> tuple[Finding, ...]:
    findings: list[Finding] = []
    lines = text.splitlines()
    offsets = _line_offsets(text)
    lexical_views: dict[str, str] = {}
    for rule in rules:
        if path.suffix.casefold() == ".java" and rule.match_in == "code":
            continue
        view = lexical_views.setdefault(rule.match_in, _lexical_view(text, rule.match_in))
        for pattern in rule.patterns:
            regex = _compiled_regex(pattern)
            for match in regex.finditer(view):
                start = match.start()
                line_number, column = _position(offsets, start)
                line_text = lines[line_number - 1].strip() if line_number <= len(lines) else ""
                if any(
                    _compiled_regex(false_positive).search(line_text)
                    for false_positive in rule.false_positive_patterns
                ):
                    continue
                evidences = (Evidence("lexical", f"Padrão '{pattern}' encontrado em {path.suffix or 'arquivo'}.", 0.35),)
                detection = 0.35
                if rule.requires_dependency_check:
                    if project_context.dependencies:
                        evidences += (Evidence("dependency", f"Dependência(s) detectada(s): {', '.join(project_context.dependencies)}.", 0.10),)
                        detection += 0.10
                    else:
                        evidences += (Evidence("dependency", "Nenhuma dependência conhecida foi detectada; a ocorrência exige revisão humana.", -0.05),)
                        detection -= 0.05
                if rule.references:
                    evidences += (Evidence("reference", f"Regra documentada por {len(rule.references)} referência(s).", 0.10),)
                    detection += 0.10
                overall = max(0.0, min(1.0, (rule.confidence if rule.confidence is not None else 0.5) * 0.55 + detection * 0.45))
                findings.append(Finding(
                    path=path,
                    line_number=line_number,
                    column=column,
                    line_text=line_text,
                    matched_text=match.group(0),
                    pattern=pattern,
                    rule=rule,
                    evidences=evidences,
                    detection_confidence=detection,
                    overall_confidence=overall,
                    suggestion_object=rule.suggestion_object,
                    structure=None,
                ))
    return tuple(findings)


def _suppressed(finding: Finding, root: Path, suppressions: tuple[Suppression, ...]) -> bool:
    relative = finding.path.relative_to(root).as_posix() if finding.path.is_relative_to(root) else finding.path.as_posix()
    for suppression in suppressions:
        if suppression.rule not in {"*", finding.rule.rule_id}:
            continue
        if suppression.file and suppression.file not in {relative, finding.path.name, finding.path.as_posix()}:
            continue
        if suppression.line and suppression.line != finding.line_number:
            continue
        return True
    return False


def scan_workspace(root: Path, config: ProjectConfig | None = None, rules_path: Path | None = None, git_range: str | None = None) -> WorkspaceResult:
    config = config or load_project_config(root)
    rules = read_rules(rules_path or root / "knowledge-base" / "rules")
    context = detect_context(root)
    effective_loader = config.target_loader or context.loader
    applicable: list[Rule] = []
    skipped: list[SkippedRule] = []
    for rule in rules:
        applies, reason = _rule_context(rule, config.source_version, config.target_version, effective_loader)
        if applies and rule.requires_ast and not config.ast:
            applies, reason = False, "análise AST desabilitada"
        if applies and rule.requires_dependency_check and not config.dependencies:
            applies, reason = False, "verificação de dependências desabilitada"
        if applies:
            applicable.append(rule)
        else:
            skipped.append(SkippedRule(rule, reason))

    files = project_files(root, config)
    findings: list[Finding] = []
    structures: list[Any] = []
    files_by_extension: dict[str, int] = {}
    for path in files:
        extension = path.suffix.casefold() or "[sem extensão]"
        files_by_extension[extension] = files_by_extension.get(extension, 0) + 1
        text = _read_source(path)
        if path.suffix.casefold() == ".java":
            result = scan(
                path,
                applicable,
                source_version=config.source_version,
                target_version=config.target_version,
                loader=effective_loader,
                analyze_ast=config.ast,
                dependencies_enabled=config.dependencies,
                project_context=context,
            )
            findings.extend(result.findings)
            structures.extend(result.structures)
        else:
            findings.extend(_text_findings(path, root, text, applicable, config, context))
    findings = [finding for finding in findings if not _suppressed(finding, root, config.suppressions)]
    findings.sort(key=lambda item: (str(item.path), item.line_number, item.column, item.rule.rule_id))
    changed_files = git_changed_files(root, git_range) if git_range else ()
    severity_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    for finding in findings:
        severity_counts[finding.rule.severity] = severity_counts.get(finding.rule.severity, 0) + 1
        category_counts[finding.rule.category] = category_counts.get(finding.rule.category, 0) + 1
    return WorkspaceResult(
        findings=tuple(findings),
        skipped_rules=tuple(skipped),
        context=context,
        config=config,
        files_seen=len(files),
        files_by_extension=dict(sorted(files_by_extension.items())),
        structures=tuple(structures),
        changed_files=tuple(changed_files),
        severity_counts=dict(sorted(severity_counts.items())),
        category_counts=dict(sorted(category_counts.items())),
        applicable_rules=len(applicable),
        total_rules=len(rules),
    )


def git_changed_files(root: Path, revision_range: str | None = None) -> tuple[str, ...]:
    git_executable = shutil.which("git")
    if git_executable is None:
        return ()
    command = [git_executable, "-C", str(root), "diff", "--name-only"]
    if revision_range:
        command.append(revision_range)
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=30)  # nosec B603 - argumentos não passam por shell e a operação é diff somente leitura
    except (OSError, subprocess.SubprocessError, subprocess.CalledProcessError):
        return ()
    return tuple(item for item in completed.stdout.splitlines() if item.strip())


def git_compare(root: Path, base: str, head: str) -> tuple[tuple[str, str], ...]:
    git_executable = shutil.which("git")
    if git_executable is None:
        raise ToolkitError("Executável Git não encontrado; compare exige um repositório Git local.")
    try:
        completed = subprocess.run(  # nosec B603 - argumentos não passam por shell e a operação é diff somente leitura
            [git_executable, "-C", str(root), "diff", "--name-status", f"{base}..{head}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError, subprocess.CalledProcessError) as exc:
        raise ToolkitError(f"Não foi possível comparar commits/branches: {exc}") from exc
    result: list[tuple[str, str]] = []
    for line in completed.stdout.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            result.append((parts[0], parts[1]))
    return tuple(result)


def render_workspace_report(root: Path, result: WorkspaceResult, mod_name: str | None = None) -> str:
    name = mod_name or root.name
    lines = [
        f"# MOD PORT REPORT — {name}",
        "",
        "> Nenhum problema conhecido encontrado não significa compatibilidade total. Este relatório representa apenas a cobertura das regras aplicáveis.",
        "",
        "## Contexto",
        "",
        f"- **Origem:** `{result.config.source_version or 'não informada'}` ({result.config.source_loader or 'não informado'})",
        f"- **Destino:** `{result.config.target_version}` ({result.config.target_loader or 'não informado'})",
        f"- **Loader detectado:** `{result.context.loader or 'não identificado'}`",
        f"- **Minecraft detectado:** `{result.context.minecraft_version or 'não identificado'}`",
        f"- **Loader version detectada:** `{result.context.loader_version or 'não identificada'}`",
        f"- **Java detectado:** `{result.context.java_version or 'não identificado'}`",
        f"- **Mappings:** {', '.join(result.context.mappings) or 'não identificados'}",
        f"- **Build systems:** {', '.join(result.context.build_systems) or 'não identificados'}",
        f"- **Plugins de build detectados:** {', '.join(result.context.gradle_plugins) or 'não identificados'}",
        f"- **Dependências:** {', '.join(result.context.dependencies) or 'não identificadas'}",
        "",
        "## Resumo",
        "",
        f"Foram analisados **{result.files_seen}** arquivo(s), com **{result.total_rules}** regra(s) carregada(s), **{result.applicable_rules}** aplicável(is), **{len(result.skipped_rules)}** ignorada(s) por contexto e **{len(result.findings)}** ocorrência(s) após suppressions.",
        f"Cobertura conhecida da base neste contexto: **{result.known_rule_coverage:.0%}** das regras carregadas foram aplicáveis. Essa métrica não estima compatibilidade total.",
        "",
        "### Ocorrências por severidade",
        "",
        "| Severidade | Quantidade |",
        "|---|---:|",
    ]
    for key in ("high", "medium", "low", "info"):
        lines.append(f"| `{key}` | {result.severity_counts.get(key, 0)} |")
    lines.extend(["", "### Ocorrências por categoria", "", "| Categoria | Quantidade |", "|---|---:|"])
    for category, count in result.category_counts.items():
        lines.append(f"| `{category}` | {count} |")
    lines.extend(["", "### Arquivos por extensão", "", "| Extensão | Arquivos |", "|---|---:|"])
    for extension, count in result.files_by_extension.items():
        lines.append(f"| `{extension}` | {count} |")
    if result.changed_files:
        lines.extend(["", "### Arquivos alterados no Git", "", *[f"- `{item}`" for item in result.changed_files]])
    lines.extend(["", "## Evidências e sugestões", ""])
    if result.findings:
        for index, finding in enumerate(result.findings, start=1):
            relative = finding.path.relative_to(root).as_posix() if finding.path.is_relative_to(root) else finding.path.as_posix()
            lines.extend([
                f"### {index}. `{finding.rule.rule_id}` — {finding.rule.category}",
                "",
                f"- **Arquivo:** `{relative}`",
                f"- **Linha/coluna:** `{finding.line_number}:{finding.column}`",
                f"- **Severidade:** `{finding.rule.severity}`",
                f"- **Confiança editorial:** `{finding.rule.confidence if finding.rule.confidence is not None else 'não definida'}`",
                f"- **Confiança da detecção:** `{finding.detection_confidence:.0%}`",
                f"- **Confiança geral:** `{finding.overall_confidence:.0%}`",
                f"- **Correspondência:** `{finding.matched_text.replace('`', '\\`')}`",
                f"- **Código:** `{finding.line_text.replace('`', '\\`')}`",
                f"- **Problema:** {finding.rule.issue}",
                f"- **Sugestão:** {finding.rule.suggestion}",
                f"- **Migration type:** `{finding.rule.migration_type or 'manual_review'}`",
                f"- **Replacement API:** `{finding.rule.replacement_api or 'não definida'}`",
                f"- **Automatizável:** `{finding.rule.automatable}`; segurança: `{finding.rule.automation_safety}`",
                *([f"- **Sugestão estruturada:** tipo `{finding.suggestion_object.suggestion_type}`, antes `{finding.suggestion_object.old or 'não definido'}`, depois `{finding.suggestion_object.new or 'não definido'}`"] if finding.suggestion_object else []),
                "- **Evidências:**",
                *[f"  - `{evidence.kind}`: {evidence.description} ({evidence.weight:+.2f})" for evidence in finding.evidences],
                f"- **Referências:** {', '.join(finding.rule.references) or 'não informadas'}",
                "",
            ])
    else:
        lines.extend(["Nenhuma ocorrência foi encontrada pelas regras aplicáveis. Isso não constitui prova de compatibilidade.", ""])
    lines.extend(["## Regras ignoradas por contexto", ""])
    for skipped in result.skipped_rules:
        lines.append(f"- `{skipped.rule.rule_id}` — {skipped.reason}.")
    if not result.skipped_rules:
        lines.append("Nenhuma regra foi ignorada por contexto.")
    lines.extend([
        "",
        "## Suppressions aplicadas",
        "",
        *([f"- `{item.rule}` em `{item.file or '*'}` linha `{item.line or '*'}` — {item.reason}" for item in result.config.suppressions] or ["Nenhuma suppression configurada."]),
        "",
        "## Limitações",
        "",
        "A análise é estática, não executa build, Gradle, Java do mod ou scripts do projeto, não aplica patches e não substitui revisão humana. A integração Git é somente leitura.",
        "",
    ])
    return "\n".join(lines)


def coverage_report(result: WorkspaceResult) -> dict[str, Any]:
    return {
        "total_rules": result.total_rules,
        "applicable_rules": result.applicable_rules,
        "known_rule_coverage": round(result.known_rule_coverage, 4),
        "finding_count": len(result.findings),
        "by_category": result.category_counts,
        "by_severity": result.severity_counts,
        "files_seen": result.files_seen,
    }
