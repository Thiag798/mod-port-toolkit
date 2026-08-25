"""Detecção estática e somente leitura do contexto de um mod."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectContext:
    loader: str | None
    java_version: str | None
    mappings: tuple[str, ...]
    dependencies: tuple[str, ...]
    evidence: tuple[str, ...]


LOADER_MARKERS = {
    "forge": ("mods.toml", "net.minecraftforge"),
    "neoforge": ("neoforge.mods.toml", "net.neoforged"),
    "fabric": ("fabric.mod.json", "net.fabricmc"),
    "quilt": ("quilt.mod.json", "org.quiltmc"),
}
MAPPING_MARKERS = {
    "yarn": ("yarn",),
    "mojmap": ("mojmap", "official mappings"),
    "srg": ("srg", "searge"),
    "parchment": ("parchment",),
}
DEPENDENCY_MARKERS = {
    "jei": ("jei", "justenoughitems"),
    "curios": ("curios",),
    "create": ("create",),
    "geckolib": ("geckolib", "gecko lib"),
}
JAVA_PATTERNS = (
    re.compile(r"languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*(\d+)\s*\)", re.I),
    re.compile(r"(?:sourceCompatibility|targetCompatibility)\s*=\s*['\"]?(\d+)", re.I),
    re.compile(r"java_version\s*[=:]\s*['\"]?(\d+)", re.I),
)


def _project_files(source: Path) -> list[Path]:
    if source.is_file():
        return [source]
    if not source.is_dir():
        return []
    return sorted(path for path in source.rglob("*") if path.is_file())


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:1_000_000]
    except OSError:
        return ""


def detect_context(source: Path) -> ProjectContext:
    files = _project_files(source)
    texts = {path: _read_text(path).casefold() for path in files}
    loaders: list[str] = []
    evidence: list[str] = []
    for loader, markers in LOADER_MARKERS.items():
        for path, text in texts.items():
            if path.name.casefold() in {marker.casefold() for marker in markers}:
                loaders.append(loader)
                evidence.append(f"{loader}: {path.name}")
                break
            if any(marker.casefold() in text for marker in markers if "." in marker):
                loaders.append(loader)
                evidence.append(f"{loader}: {path.name}")
                break
    loaders = list(dict.fromkeys(loaders))
    loader = loaders[0] if len(loaders) == 1 else ("ambiguous" if loaders else None)

    java_version: str | None = None
    for path, text in texts.items():
        for pattern in JAVA_PATTERNS:
            match = pattern.search(text)
            if match:
                java_version = match.group(1)
                evidence.append(f"java {java_version}: {path.name}")
                break
        if java_version:
            break

    mappings: list[str] = []
    for name, markers in MAPPING_MARKERS.items():
        for path, text in texts.items():
            if any(marker.casefold() in text for marker in markers):
                mappings.append(name)
                evidence.append(f"mapping {name}: {path.name}")
                break

    dependencies: list[str] = []
    for name, markers in DEPENDENCY_MARKERS.items():
        for path, text in texts.items():
            if any(marker.casefold() in text for marker in markers):
                dependencies.append(name)
                evidence.append(f"dependency {name}: {path.name}")
                break

    return ProjectContext(
        loader=loader,
        java_version=java_version,
        mappings=tuple(mappings),
        dependencies=tuple(dependencies),
        evidence=tuple(dict.fromkeys(evidence)),
    )
