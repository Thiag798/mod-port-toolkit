"""Scanner somente leitura para localizar incompatibilidades em fontes Java.

O scanner lê uma base YAML validada, aplica padrões apenas ao contexto solicitado,
ignora comentários e permite escolher se uma regra procura código, literais ou ambos.
Ele nunca altera o código-fonte nem executa processos externos.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from scanner.context import ProjectContext, detect_context
except ModuleNotFoundError:  # execução direta: python scanner/scan.py
    from context import ProjectContext, detect_context

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover - mensagem de ambiente
    raise SystemExit(
        "Dependência ausente: instale PyYAML com 'python3 -m pip install -r requirements.txt'."
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULES = PROJECT_ROOT / "knowledge-base" / "rules"
DEFAULT_REPORTS = PROJECT_ROOT / "reports"
VERSION_RE = re.compile(r"^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$")
LEGACY_CONDITION_RE = re.compile(
    r"^(?:(source|target)\s*)?(<=|>=|==|<|>)\s*(\d+(?:\.\d+)+)$",
    re.IGNORECASE,
)


class ToolkitError(Exception):
    """Erro de entrada ou configuração apresentado ao usuário."""


@dataclass(frozen=True)
class VersionRange:
    minimum: str | None = None
    maximum: str | None = None


@dataclass(frozen=True)
class Rule:
    rule_id: str
    patterns: tuple[str, ...]
    issue: str
    suggestion: str
    severity: str
    applies_to: str | None
    confidence: float | None
    references: tuple[str, ...]
    loaders: tuple[str, ...]
    source_versions: VersionRange | None
    target_versions: VersionRange | None
    match_in: str


@dataclass(frozen=True)
class Finding:
    path: Path
    line_number: int
    column: int
    line_text: str
    matched_text: str
    pattern: str
    rule: Rule


@dataclass(frozen=True)
class SkippedRule:
    rule: Rule
    reason: str


@dataclass(frozen=True)
class ScanResult:
    findings: tuple[Finding, ...]
    files_seen: int
    skipped_rules: tuple[SkippedRule, ...]


def _as_string(value: Any, field: str, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise ToolkitError(f"Campo obrigatório ausente: {field}.")
        return None
    if not isinstance(value, str):
        raise ToolkitError(f"O campo '{field}' deve ser texto.")
    value = value.strip()
    if required and not value:
        raise ToolkitError(f"O campo obrigatório '{field}' não pode ser vazio.")
    return value or None


def _as_string_tuple(value: Any, field: str) -> tuple[str, ...]:
    if value is None:
        return ()
    values = [value] if isinstance(value, str) else value
    if not isinstance(values, list) or not values:
        raise ToolkitError(f"O campo '{field}' deve ser texto ou lista de textos.")
    result: list[str] = []
    for item in values:
        if not isinstance(item, str) or not item.strip():
            raise ToolkitError(f"Todos os itens de '{field}' devem ser textos não vazios.")
        result.append(item.strip())
    return tuple(result)


def _validate_version(value: str, field: str) -> str:
    if not VERSION_RE.fullmatch(value):
        raise ToolkitError(
            f"Versão inválida em '{field}': {value!r}. Use, por exemplo, '1.20.1'."
        )
    return value


def _parse_version_range(value: Any, field: str) -> VersionRange | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        match = re.fullmatch(r"(<=|>=|==|<|>)?\s*(\d+(?:\.\d+)+)", text)
        if not match:
            raise ToolkitError(
                f"O campo '{field}' deve ser uma versão ou uma comparação de versão."
            )
        operator, version = match.groups()
        version = _validate_version(version, field)
        if operator in (">", ">="):
            return VersionRange(minimum=version)
        if operator in ("<", "<="):
            return VersionRange(maximum=version)
        return VersionRange(minimum=version, maximum=version)
    if not isinstance(value, dict):
        raise ToolkitError(f"O campo '{field}' deve ser texto ou objeto com min/max.")
    unknown = set(value) - {"min", "max"}
    if unknown:
        raise ToolkitError(f"Campos desconhecidos em '{field}': {', '.join(sorted(unknown))}.")
    minimum = _as_string(value.get("min"), f"{field}.min")
    maximum = _as_string(value.get("max"), f"{field}.max")
    if minimum:
        minimum = _validate_version(minimum, f"{field}.min")
    if maximum:
        maximum = _validate_version(maximum, f"{field}.max")
    if minimum and maximum and _version_key(minimum) > _version_key(maximum):
        raise ToolkitError(f"O intervalo '{field}' possui min maior que max.")
    if not minimum and not maximum:
        raise ToolkitError(f"O intervalo '{field}' precisa de min ou max.")
    return VersionRange(minimum=minimum, maximum=maximum)


def _parse_legacy_conditions(expression: str) -> tuple[tuple[str, str, str], ...]:
    parts = re.split(r"\s+AND\s+", expression.strip(), flags=re.IGNORECASE)
    conditions: list[tuple[str, str, str]] = []
    for part in parts:
        match = LEGACY_CONDITION_RE.fullmatch(part.strip())
        if not match:
            raise ToolkitError(
                "Expressão 'applies_to' inválida. Use, por exemplo, "
                "'source<1.13 AND target>=1.13'."
            )
        field, operator, version = match.groups()
        conditions.append((field.lower() if field else "target", operator, version))
    return tuple(conditions)


def _rule_from_mapping(data: Any, index: int) -> Rule:
    if not isinstance(data, dict):
        raise ToolkitError(f"A regra #{index} deve ser um objeto YAML.")
    rule_id = _as_string(data.get("id"), f"rules[{index}].id", required=True)
    pattern_value = data.get("patterns", data.get("pattern"))
    patterns = _as_string_tuple(pattern_value, f"rules[{index}].pattern")
    if not patterns:
        raise ToolkitError(f"A regra '{rule_id}' precisa de 'pattern' ou 'patterns'.")

    issue = _as_string(data.get("issue"), f"rules[{index}].issue") or "Não informado."
    suggestion = _as_string(data.get("suggestion"), f"rules[{index}].suggestion") or "Não informada."
    severity = _as_string(data.get("severity"), f"rules[{index}].severity") or "Não definida"
    applies_to = _as_string(data.get("applies_to"), f"rules[{index}].applies_to")
    if applies_to:
        _parse_legacy_conditions(applies_to)

    confidence_value = data.get("confidence")
    if confidence_value is not None:
        if isinstance(confidence_value, bool) or not isinstance(confidence_value, (int, float)):
            raise ToolkitError(f"A confiança da regra '{rule_id}' deve ser numérica entre 0 e 1.")
        confidence = float(confidence_value)
        if not 0 <= confidence <= 1:
            raise ToolkitError(f"A confiança da regra '{rule_id}' deve estar entre 0 e 1.")
    else:
        confidence = None

    match_in = _as_string(data.get("match_in"), f"rules[{index}].match_in") or "code"
    if match_in not in {"code", "strings", "both"}:
        raise ToolkitError(
            f"A regra '{rule_id}' possui match_in inválido: {match_in!r}. Use code, strings ou both."
        )

    loaders = _as_string_tuple(data.get("loaders", data.get("loader")), f"rules[{index}].loader")
    references = _as_string_tuple(data.get("references"), f"rules[{index}].references")
    source_versions = _parse_version_range(data.get("source_versions"), f"rules[{index}].source_versions")
    target_versions = _parse_version_range(data.get("target_versions"), f"rules[{index}].target_versions")

    allowed = {
        "id", "pattern", "patterns", "issue", "suggestion", "severity", "applies_to",
        "confidence", "match_in", "loader", "loaders", "references", "source_versions",
        "target_versions",
    }
    unknown = set(data) - allowed
    if unknown:
        raise ToolkitError(f"Campos desconhecidos na regra '{rule_id}': {', '.join(sorted(unknown))}.")

    return Rule(
        rule_id=rule_id,
        patterns=patterns,
        issue=issue,
        suggestion=suggestion,
        severity=severity,
        applies_to=applies_to,
        confidence=confidence,
        references=references,
        loaders=loaders,
        source_versions=source_versions,
        target_versions=target_versions,
        match_in=match_in,
    )


def _read_rule_file(path: Path) -> list[Rule]:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        raise ToolkitError(f"Não foi possível ler a base de regras '{path}': {exc}") from exc
    except yaml.YAMLError as exc:
        raise ToolkitError(f"YAML inválido em '{path}': {exc}") from exc

    if raw is None:
        return []
    if isinstance(raw, dict):
        if set(raw) != {"rules"}:
            unknown = set(raw) - {"rules"}
            raise ToolkitError(
                f"A raiz de '{path.name}' deve conter somente 'rules'. "
                f"Campos encontrados: {', '.join(sorted(unknown))}."
            )
        raw = raw["rules"]
    if not isinstance(raw, list):
        raise ToolkitError(f"A raiz de '{path.name}' deve ser uma lista ou conter 'rules: []'.")

    parsed: list[Rule] = []
    for index, item in enumerate(raw, start=1):
        try:
            parsed.append(_rule_from_mapping(item, index))
        except ToolkitError as exc:
            raise ToolkitError(f"{path.name}, regra #{index}: {exc}") from exc
    return parsed


def read_rules(path: Path) -> list[Rule]:
    """Carrega e valida um YAML ou todos os YAML de uma pasta versionada."""
    if not path.exists():
        raise ToolkitError(f"Base de regras não encontrada: {path}")
    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = sorted(item for item in path.rglob("*.yaml") if item.is_file())
        if not files:
            return []
    else:
        raise ToolkitError(f"Base de regras inválida: {path}")

    rules: list[Rule] = []
    seen: set[str] = set()
    for file in files:
        for rule in _read_rule_file(file):
            if rule.rule_id in seen:
                raise ToolkitError(f"ID de regra duplicado: '{rule.rule_id}'.")
            seen.add(rule.rule_id)
            rules.append(rule)
    return rules


def _version_key(value: str) -> tuple[int, ...]:
    match = re.match(r"^(\d+(?:\.\d+)*)", value)
    if not match:
        raise ToolkitError(f"Versão inválida: {value!r}.")
    return tuple(int(part) for part in match.group(1).split("."))


def _compare_versions(left: str, right: str) -> int:
    a, b = _version_key(left), _version_key(right)
    length = max(len(a), len(b))
    aa = a + (0,) * (length - len(a))
    bb = b + (0,) * (length - len(b))
    return (aa > bb) - (aa < bb)


def _matches_range(version: str, version_range: VersionRange) -> bool:
    if version_range.minimum and _compare_versions(version, version_range.minimum) < 0:
        return False
    if version_range.maximum and _compare_versions(version, version_range.maximum) > 0:
        return False
    return True


def _matches_condition(version: str, operator: str, expected: str) -> bool:
    comparison = _compare_versions(version, expected)
    return {
        "<": comparison < 0,
        "<=": comparison <= 0,
        "==": comparison == 0,
        ">=": comparison >= 0,
        ">": comparison > 0,
    }[operator]


def _rule_context(rule: Rule, source_version: str | None, target_version: str, loader: str | None) -> tuple[bool, str]:
    if rule.source_versions:
        if not source_version:
            return False, "versão de origem não informada"
        if not _matches_range(source_version, rule.source_versions):
            return False, "versão de origem fora do intervalo da regra"
    if rule.target_versions and not _matches_range(target_version, rule.target_versions):
        return False, "versão de destino fora do intervalo da regra"
    if rule.loaders:
        if not loader:
            return False, "loader não informado"
        allowed = {item.casefold() for item in rule.loaders}
        if loader.casefold() not in allowed:
            return False, "loader fora do conjunto da regra"
    if rule.applies_to:
        for field, operator, expected in _parse_legacy_conditions(rule.applies_to):
            actual = source_version if field == "source" else target_version
            if actual is None:
                return False, f"versão de {field} não informada"
            if not _matches_condition(actual, operator, expected):
                return False, f"condição {field}{operator}{expected} não satisfeita"
    return True, "aplicável"


def java_files(source: Path) -> Iterable[Path]:
    if source.is_file():
        if source.suffix.casefold() != ".java":
            raise ToolkitError(f"A fonte individual precisa ter extensão .java: {source}")
        yield source
        return
    if source.is_dir():
        yield from sorted(path for path in source.rglob("*.java") if path.is_file())
        return
    raise ToolkitError(f"Fonte não encontrada: {source}")


def _blank(character: str) -> str:
    return "\n" if character == "\n" else " "


def _lexical_view(text: str, mode: str) -> str:
    """Cria uma visão de tamanho idêntico, preservando posições de linhas/colunas."""
    keep_code = mode in {"code", "both"}
    keep_strings = mode in {"strings", "both"}
    output: list[str] = []
    state = "code"
    index = 0

    while index < len(text):
        character = text[index]
        next_two = text[index:index + 2]
        next_three = text[index:index + 3]

        if state == "code":
            if next_two == "//":
                output.extend((" ", " "))
                index += 2
                state = "line_comment"
            elif next_two == "/*":
                output.extend((" ", " "))
                index += 2
                state = "block_comment"
            elif next_three == '"""':
                output.extend(character if keep_strings else _blank(character) for character in next_three)
                index += 3
                state = "text_block"
            elif character == '"':
                output.append(character if keep_strings else _blank(character))
                index += 1
                state = "string"
            elif character == "'":
                output.append(character if keep_strings else _blank(character))
                index += 1
                state = "char"
            else:
                output.append(character if keep_code else _blank(character))
                index += 1
        elif state == "line_comment":
            output.append(_blank(character))
            index += 1
            if character == "\n":
                state = "code"
        elif state == "block_comment":
            if next_two == "*/":
                output.extend((" ", " "))
                index += 2
                state = "code"
            else:
                output.append(_blank(character))
                index += 1
        elif state in {"string", "char"}:
            output.append(character if keep_strings else _blank(character))
            index += 1
            if character == "\\" and index < len(text):
                escaped = text[index]
                output.append(escaped if keep_strings else _blank(escaped))
                index += 1
            elif (state == "string" and character == '"') or (state == "char" and character == "'"):
                state = "code"
        elif state == "text_block":
            if next_three == '"""':
                output.extend(character if keep_strings else _blank(character) for character in next_three)
                index += 3
                state = "code"
            else:
                output.append(character if keep_strings else _blank(character))
                index += 1

    return "".join(output)


def _display_path(path: Path, source: Path) -> str:
    if source.is_dir():
        try:
            return path.relative_to(source).as_posix()
        except ValueError:
            pass
    return path.as_posix()


def scan(
    source: Path,
    rules: list[Rule],
    *,
    source_version: str | None,
    target_version: str,
    loader: str | None,
) -> ScanResult:
    """Varre as fontes aplicáveis e retorna achados sem tocar nos arquivos."""
    if source_version:
        _validate_version(source_version, "--source-version")
    _validate_version(target_version, "--target-version")
    paths = list(java_files(source))
    applicable: list[Rule] = []
    skipped: list[SkippedRule] = []
    for rule in rules:
        applies, reason = _rule_context(rule, source_version, target_version, loader)
        if applies:
            applicable.append(rule)
        else:
            skipped.append(SkippedRule(rule, reason))

    compiled: list[tuple[Rule, str, re.Pattern[str]]] = []
    for rule in applicable:
        for pattern in rule.patterns:
            try:
                compiled.append((rule, pattern, re.compile(pattern)))
            except re.error as exc:
                raise ToolkitError(f"Regex inválida na regra '{rule.rule_id}': {exc}") from exc

    findings: list[Finding] = []
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise ToolkitError(f"Não foi possível ler '{path}': {exc}") from exc

        views = {mode: _lexical_view(text, mode) for mode in {rule.match_in for rule in applicable}}
        lines = text.splitlines()
        seen: set[tuple[str, int, int, str]] = set()
        for rule, pattern, regex in compiled:
            view = views[rule.match_in]
            for match in regex.finditer(view):
                start = match.start()
                line_number = text.count("\n", 0, start) + 1
                line_start = text.rfind("\n", 0, start) + 1
                column = start - line_start + 1
                line_text = lines[line_number - 1].strip() if line_number <= len(lines) else ""
                matched_text = match.group(0)
                key = (rule.rule_id, line_number, column, matched_text)
                if key in seen:
                    continue
                seen.add(key)
                findings.append(
                    Finding(
                        path=path,
                        line_number=line_number,
                        column=column,
                        line_text=line_text,
                        matched_text=matched_text,
                        pattern=pattern,
                        rule=rule,
                    )
                )

    findings.sort(key=lambda item: (str(item.path), item.line_number, item.column, item.rule.rule_id))
    return ScanResult(tuple(findings), len(paths), tuple(skipped))


def _confidence_text(confidence: float | None) -> str:
    return "Não definida" if confidence is None else f"{confidence:.0%}"


def _format_range(version_range: VersionRange | None) -> str:
    if not version_range:
        return "qualquer"
    if version_range.minimum and version_range.maximum and version_range.minimum == version_range.maximum:
        return version_range.minimum
    if version_range.minimum and version_range.maximum:
        return f"{version_range.minimum}–{version_range.maximum}"
    if version_range.minimum:
        return f">={version_range.minimum}"
    return f"<={version_range.maximum}"


def render_report(
    mod_name: str,
    source: Path,
    source_version: str | None,
    target_version: str,
    loader: str | None,
    rules: list[Rule],
    result: ScanResult,
    project_context: ProjectContext | None = None,
) -> str:
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        f"# Relatório de Portabilidade — {mod_name}",
        "",
        f"- **Origem analisada:** `{source}`",
        f"- **Versão de origem:** `{source_version or 'não informada'}`",
        f"- **Versão de destino:** `{target_version}`",
        f"- **Loader:** `{loader or 'não informado'}`",
        f"- **Gerado em:** `{generated}`",
        "- **Modo:** somente leitura; nenhum arquivo-fonte foi alterado.",
        "",
        "## Contexto detectado",
        "",
    ]
    if project_context is not None:
        lines.extend([
            f"- **Loader detectado:** `{project_context.loader or 'não identificado'}`",
            f"- **Java detectado:** `{project_context.java_version or 'não identificado'}`",
            f"- **Mappings detectados:** {', '.join(project_context.mappings) if project_context.mappings else 'não identificados'}",
            f"- **Dependências detectadas:** {', '.join(project_context.dependencies) if project_context.dependencies else 'não identificadas'}",
            f"- **Evidências:** {', '.join(project_context.evidence) if project_context.evidence else 'nenhuma'}",
            "",
        ])
    else:
        lines.extend([
            "A detecção estática de contexto não foi solicitada.",
            "",
        ])
    lines.extend([
        "## Resumo",
        "",
        f"Foram analisados **{result.files_seen}** arquivo(s) Java com **{len(rules)}** regra(s) carregada(s), "
        f"**{len(result.skipped_rules)}** regra(s) fora do contexto e **{len(result.findings)}** ocorrência(s).",
        "",
    ])
    if not rules:
        lines.extend([
            "> A base de conhecimento está vazia. Nenhuma regra foi aplicada e nenhuma conclusão de compatibilidade deve ser inferida.",
            "",
        ])
    elif result.findings:
        lines.extend(["## Ocorrências", ""])
        for index, finding in enumerate(result.findings, start=1):
            lines.extend([
                f"### {index}. `{finding.rule.rule_id}`",
                "",
                f"- **Arquivo:** `{_display_path(finding.path, source)}`",
                f"- **Linha/coluna:** `{finding.line_number}:{finding.column}`",
                f"- **Severidade:** {finding.rule.severity}",
                f"- **Confiança editorial:** {_confidence_text(finding.rule.confidence)}",
                f"- **Aplicável a:** origem `{_format_range(finding.rule.source_versions)}`, destino `{_format_range(finding.rule.target_versions)}`",
                *([f"- **Condição adicional:** `{finding.rule.applies_to}`"] if finding.rule.applies_to else []),
                f"- **Loader(s):** {', '.join(finding.rule.loaders) if finding.rule.loaders else 'qualquer'}",
                f"- **Padrão:** `{finding.pattern}`",
                f"- **Correspondência:** `{finding.matched_text}`",
                "- **Código:**",
                "",
                f"    {finding.line_text.replace(chr(9), '    ')}",
                f"- **Problema:** {finding.rule.issue}",
                f"- **Sugestão:** {finding.rule.suggestion}",
                f"- **Referências:** {', '.join(finding.rule.references) if finding.rule.references else 'não informadas'}",
                "",
            ])
    else:
        lines.extend(["Nenhuma ocorrência foi encontrada pelas regras aplicáveis.", ""])

    if result.skipped_rules:
        lines.extend(["## Regras não aplicadas por contexto", ""])
        for item in result.skipped_rules:
            lines.extend([
                f"- `{item.rule.rule_id}` — {item.reason}.",
            ])
        lines.append("")

    lines.extend([
        "## Limites desta execução",
        "",
        "Este relatório faz busca orientada por padrões em fontes Java. Ele não reescreve arquivos, não aplica patches e não substitui a revisão humana. Um achado é um ponto de investigação, não uma prova isolada de incompatibilidade.",
        "",
    ])
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analisa arquivos Java usando regras de portabilidade.")
    parser.add_argument("--source", required=True, type=Path, help="Arquivo Java ou diretório do código-fonte.")
    parser.add_argument("--target-version", required=True, help="Versão de destino, por exemplo 1.20.1.")
    parser.add_argument("--source-version", help="Versão de origem, necessária para regras com escopo de origem.")
    parser.add_argument("--loader", help="Loader do mod, por exemplo forge, neoforge, fabric ou quilt.")
    parser.add_argument("--detect-context", action="store_true", help="Detecta estaticamente loader, Java, mappings e dependências.")
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES, help="Caminho da base YAML.")
    parser.add_argument("--output", type=Path, help="Caminho do relatório Markdown.")
    parser.add_argument("--mod-name", help="Nome do mod exibido no relatório.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        source = args.source
        rules = read_rules(args.rules)
        project_context = detect_context(source) if args.detect_context else None
        effective_loader = args.loader
        if effective_loader is None and project_context is not None and project_context.loader not in (None, "ambiguous"):
            effective_loader = project_context.loader
        result = scan(
            source,
            rules,
            source_version=args.source_version,
            target_version=args.target_version,
            loader=effective_loader,
        )
        mod_name = args.mod_name or (source.name if source.is_dir() else source.stem)
        output = args.output or DEFAULT_REPORTS / f"{mod_name}.md"
        output.parent.mkdir(parents=True, exist_ok=True)
        report = render_report(
            mod_name,
            source,
            args.source_version,
            args.target_version,
            effective_loader,
            rules,
            result,
            project_context,
        )
        output.write_text(report, encoding="utf-8")
        print(
            f"Análise concluída: {result.files_seen} arquivo(s), {len(rules)} regra(s), "
            f"{len(result.findings)} ocorrência(s), {len(result.skipped_rules)} regra(s) fora do contexto."
        )
        print(f"Relatório: {output}")
        if not rules:
            print("Aviso: a base de conhecimento está vazia; nenhuma regra foi aplicada.")
        return 0
    except ToolkitError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"Erro de arquivo: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
