"""Extração estrutural somente leitura para Java.

Quando ``javalang`` está disponível, a camada usa a árvore sintática para
localizar imports, tipos, herança, interfaces, annotations e chamadas. Se a
dependência não estiver disponível ou o arquivo estiver incompleto, aplica um
fallback conservador por regex e marca a estrutura como parcial.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:  # dependência opcional para permitir uso mínimo do scanner
    import javalang
except ModuleNotFoundError:  # pragma: no cover - exercitado em ambientes mínimos
    javalang = None  # type: ignore[assignment]


@dataclass(frozen=True)
class JavaSymbol:
    kind: str
    name: str
    line: int
    column: int
    detail: str = ""


@dataclass(frozen=True)
class JavaStructure:
    path: Path
    imports: tuple[JavaSymbol, ...]
    types: tuple[JavaSymbol, ...]
    methods: tuple[JavaSymbol, ...]
    calls: tuple[JavaSymbol, ...]
    annotations: tuple[JavaSymbol, ...]
    partial: bool
    parser: str

    @property
    def symbols(self) -> tuple[JavaSymbol, ...]:
        return self.imports + self.types + self.methods + self.calls + self.annotations


def _position(node: Any) -> tuple[int, int]:
    position = getattr(node, "position", None)
    if position is None:
        return (1, 1)
    return (int(position.line), int(position.column or 1))


def _name(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return ".".join(_name(item) for item in value)
    if hasattr(value, "name"):
        return _name(getattr(value, "name"))
    return str(value)


def _parse_with_javalang(path: Path, text: str) -> JavaStructure:
    tree = javalang.parse.parse(text)
    imports: list[JavaSymbol] = []
    types: list[JavaSymbol] = []
    methods: list[JavaSymbol] = []
    calls: list[JavaSymbol] = []
    annotations: list[JavaSymbol] = []

    for node in tree.imports:
        line, column = _position(node)
        imports.append(JavaSymbol("import", _name(node.path), line, column, "static" if node.static else ""))

    for _, node in tree.filter(javalang.tree.TypeDeclaration):
        line, column = _position(node)
        extends = _name(getattr(node, "extends", None))
        implements = ", ".join(_name(item) for item in (getattr(node, "implements", None) or []))
        detail = "; ".join(item for item in [f"extends {extends}" if extends else "", f"implements {implements}" if implements else ""] if item)
        types.append(JavaSymbol("type", node.name, line, column, detail))

    for _, node in tree.filter(javalang.tree.LocalVariableDeclaration):
        line, column = _position(node)
        type_name = _name(getattr(node, "type", None))
        if type_name:
            types.append(JavaSymbol("type_ref", type_name, line, column))

    for _, node in tree.filter(javalang.tree.MethodDeclaration):
        line, column = _position(node)
        methods.append(JavaSymbol("method", node.name, line, column, _name(getattr(node, "return_type", None))))

    for _, node in tree.filter(javalang.tree.MethodInvocation):
        line, column = _position(node)
        qualifier = _name(getattr(node, "qualifier", None))
        calls.append(JavaSymbol("call", f"{qualifier + '.' if qualifier else ''}{node.member}", line, column, str(len(getattr(node, "arguments", []) or []))))

    for _, node in tree.filter(javalang.tree.Annotation):
        line, column = _position(node)
        annotations.append(JavaSymbol("annotation", _name(getattr(node, "name", None)), line, column))

    return JavaStructure(
        path=path,
        imports=tuple(imports),
        types=tuple(types),
        methods=tuple(methods),
        calls=tuple(calls),
        annotations=tuple(annotations),
        partial=False,
        parser="javalang",
    )


def _line_number(text: str, offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, offset) + 1
    start = text.rfind("\n", 0, offset) + 1
    return line, offset - start + 1


def _fallback(path: Path, text: str) -> JavaStructure:
    imports: list[JavaSymbol] = []
    types: list[JavaSymbol] = []
    methods: list[JavaSymbol] = []
    calls: list[JavaSymbol] = []
    annotations: list[JavaSymbol] = []
    clean = re.sub(r"(?s)/\*.*?\*/|//[^\n]*", "", text)

    for match in re.finditer(r"\bimport\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$*]*)*)", clean):
        line, column = _line_number(clean, match.start(1))
        imports.append(JavaSymbol("import", match.group(1), line, column))
    for match in re.finditer(r"\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([A-Za-z_$][\w$.<>]*))?\s*(?:implements\s+([^\{]+))?", clean):
        line, column = _line_number(clean, match.start(2))
        detail = "; ".join(item for item in [f"extends {match.group(3)}" if match.group(3) else "", f"implements {match.group(4).strip()}" if match.group(4) else ""] if item)
        types.append(JavaSymbol("type", match.group(2), line, column, detail))
    for match in re.finditer(r"\b([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^\{]+)?\{", clean):
        line, column = _line_number(clean, match.start(1))
        if match.group(1) not in {"if", "for", "while", "switch", "catch", "new"}:
            methods.append(JavaSymbol("method", match.group(1), line, column))
    for match in re.finditer(r"\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(", clean):
        line, column = _line_number(clean, match.start(1))
        name = match.group(1)
        if name.split(".")[-1] not in {"if", "for", "while", "switch", "catch"}:
            calls.append(JavaSymbol("call", name, line, column))
    for match in re.finditer(r"@([A-Za-z_$][\w$.]*)", clean):
        line, column = _line_number(clean, match.start(1))
        annotations.append(JavaSymbol("annotation", match.group(1), line, column))

    return JavaStructure(
        path=path,
        imports=tuple(imports),
        types=tuple(types),
        methods=tuple(methods),
        calls=tuple(calls),
        annotations=tuple(annotations),
        partial=True,
        parser="regex-fallback",
    )


def parse_java(path: Path, text: str) -> JavaStructure:
    """Extrai símbolos sem alterar o arquivo e sem executar qualquer projeto."""
    if javalang is not None:
        try:
            return _parse_with_javalang(path, text)
        except (SyntaxError, TypeError, ValueError):
            pass
    return _fallback(path, text)


def structure_matches(structure: JavaStructure, pattern: str) -> tuple[JavaSymbol, ...]:
    """Retorna símbolos cujo nome ou detalhe contém o padrão literal/regex."""
    try:
        regex = re.compile(pattern)
    except re.error:
        regex = re.compile(re.escape(pattern))
    return tuple(symbol for symbol in structure.symbols if regex.search(symbol.name) or regex.search(symbol.detail))
