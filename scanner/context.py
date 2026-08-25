"""Detecção estática e somente leitura do contexto de um mod.

O detector examina nomes e conteúdo de arquivos de configuração; nunca executa
Gradle, Java, scripts do projeto ou qualquer processo fornecido pelo mod.
"""

from __future__ import annotations

import json
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
    minecraft_version: str | None = None
    loader_version: str | None = None
    build_systems: tuple[str, ...] = ()
    gradle_version: str | None = None
    gradle_plugins: tuple[str, ...] = ()
    dependency_versions: tuple[str, ...] = ()
    confidence: float = 0.0


LOADER_MARKERS = {
    "forge": ("mods.toml", "net.minecraftforge", "forgegradle"),
    "neoforge": ("neoforge.mods.toml", "net.neoforged", "neogradle"),
    "fabric": ("fabric.mod.json", "net.fabricmc", "fabric-loom"),
    "quilt": ("quilt.mod.json", "org.quiltmc", "quilt-loom"),
}
MAPPING_MARKERS = {
    "yarn": ("yarn",),
    "mojmap": ("mojmap", "official mappings", "official_mappings"),
    "srg": ("srg", "searge"),
    "parchment": ("parchment",),
}
DEPENDENCY_MARKERS = {
    "jei": ("jei", "justenoughitems"),
    "curios": ("curios",),
    "create": ("create",),
    "geckolib": ("geckolib", "gecko lib"),
    "architectury": ("architectury",),
    "cloth-config": ("cloth-config", "cloth_config", "cloth config"),
}
JAVA_PATTERNS = (
    re.compile(r"languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*(\d+)\s*\)", re.I),
    re.compile(r"(?:sourceCompatibility|targetCompatibility)\s*=\s*['\"]?(\d+)", re.I),
    re.compile(r"java_version\s*[=:]\s*['\"]?(\d+)", re.I),
    re.compile(r"javaVersion\s*[=:]\s*['\"]?(\d+)", re.I),
)
MINECRAFT_PATTERNS = (
    re.compile(r"(?:minecraft_version|minecraftVersion|minecraft)\s*[=:]\s*['\"]?([0-9]+(?:\.[0-9]+)+)", re.I),
    re.compile(r"net\.minecraft:minecraft:([0-9]+(?:\.[0-9]+)+)", re.I),
    re.compile(r"minecraftVersion\s*=\s*\"([0-9]+(?:\.[0-9]+)+)\"", re.I),
)
GRADLE_VERSION_PATTERN = re.compile(r"distributionUrl=.*gradle-([0-9]+(?:\.[0-9]+)+)-", re.I)
LOADER_VERSION_PATTERNS = (
    re.compile(r"(?:forge_version|neoforge_version|loader_version|fabric_loader_version|quilt_loader_version)\s*[=:]\s*['\"]?([0-9A-Za-z.+-]+)", re.I),
    re.compile(r"net\.(?:minecraftforge|neoforged):[^:]+:([0-9A-Za-z.+-]+)", re.I),
)


def _project_files(source: Path) -> list[Path]:
    if source.is_file():
        return [source]
    if not source.is_dir():
        return []
    ignored = {".git", ".gradle", "node_modules", "build", "out", "bin", "dist", ".security-audit"}
    return sorted(path for path in source.rglob("*") if path.is_file() and not ignored.intersection(path.parts))


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:1_000_000]
    except OSError:
        return ""


def _first_match(texts: dict[Path, str], patterns: tuple[re.Pattern[str], ...]) -> tuple[str | None, str | None]:
    for path, text in texts.items():
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1), f"{match.group(1)}: {path.name}"
    return None, None


def _json_dependencies(path: Path, text: str) -> list[str]:
    if path.name not in {"fabric.mod.json", "quilt.mod.json"}:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    values: list[str] = []
    for key in ("depends", "recommends", "suggests", "conflicts", "breaks"):
        raw = data.get(key, {}) if isinstance(data, dict) else {}
        if isinstance(raw, dict):
            values.extend(str(item) for item in raw)
    return values


def detect_context(source: Path) -> ProjectContext:
    files = _project_files(source)
    texts = {path: _read_text(path) for path in files}
    lower_texts = {path: text.casefold() for path, text in texts.items()}
    loaders: list[str] = []
    evidence: list[str] = []
    loader_versions: list[str] = []
    for loader, markers in LOADER_MARKERS.items():
        for path, text in lower_texts.items():
            file_name = path.name.casefold()
            if any(file_name == marker.casefold() for marker in markers):
                loaders.append(loader)
                evidence.append(f"{loader}: {path.name}")
                break
            if any(marker.casefold() in text for marker in markers if "." in marker or "-" not in marker):
                loaders.append(loader)
                evidence.append(f"{loader}: {path.name}")
                break
    for path, text in texts.items():
        for pattern in LOADER_VERSION_PATTERNS:
            match = pattern.search(text)
            if match:
                loader_versions.append(match.group(1))
                evidence.append(f"loader {match.group(1)}: {path.name}")
                break
    loaders = list(dict.fromkeys(loaders))
    loader = loaders[0] if len(loaders) == 1 else ("ambiguous" if loaders else None)

    java_version, java_evidence = _first_match(texts, JAVA_PATTERNS)
    if java_evidence:
        evidence.append(f"java {java_evidence}")
    minecraft_version, minecraft_evidence = _first_match(texts, MINECRAFT_PATTERNS)
    if minecraft_evidence:
        evidence.append(f"minecraft {minecraft_evidence}")
    gradle_version, gradle_evidence = _first_match(texts, (GRADLE_VERSION_PATTERN,))
    if gradle_evidence:
        evidence.append(f"gradle {gradle_evidence}")

    mappings: list[str] = []
    for name, markers in MAPPING_MARKERS.items():
        for path, text in lower_texts.items():
            if any(marker.casefold() in text for marker in markers):
                mappings.append(name)
                evidence.append(f"mapping {name}: {path.name}")
                break

    dependencies: list[str] = []
    dependency_versions: list[str] = []
    for name, markers in DEPENDENCY_MARKERS.items():
        for path, text in lower_texts.items():
            if any(re.search(rf"(?<![a-z0-9]){re.escape(marker.casefold())}(?![a-z0-9])", text) for marker in markers):
                dependencies.append(name)
                evidence.append(f"dependency {name}: {path.name}")
                break
    for path, text in texts.items():
        dependencies.extend(_json_dependencies(path, text))
        for match in re.finditer(r"([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)", text):
            dependency_versions.append(f"{match.group(1)}:{match.group(2)}:{match.group(3)}")

    build_systems: list[str] = []
    gradle_plugins: list[str] = []
    for path, text in lower_texts.items():
        if path.name in {"build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"}:
            if "plugins" not in build_systems:
                build_systems.append("gradle")
            if "fabric-loom" in text:
                gradle_plugins.append("fabric-loom")
            if "forgegradle" in text:
                gradle_plugins.append("forgegradle")
            if "neogradle" in text:
                gradle_plugins.append("neogradle")
            if "architectury-plugin" in text:
                gradle_plugins.append("architectury-plugin")
        if path.name == "pom.xml":
            build_systems.append("maven")
        if path.name == "gradlew" or path.name == "gradlew.bat":
            build_systems.append("gradle-wrapper")
    build_systems = list(dict.fromkeys(build_systems))
    gradle_plugins = list(dict.fromkeys(gradle_plugins))
    dependencies = list(dict.fromkeys(dependencies))
    dependency_versions = list(dict.fromkeys(dependency_versions))
    evidence = list(dict.fromkeys(evidence))
    evidence_count = len(evidence)
    confidence = min(1.0, evidence_count / 8.0) if evidence_count else 0.0

    return ProjectContext(
        loader=loader,
        java_version=java_version,
        mappings=tuple(dict.fromkeys(mappings)),
        dependencies=tuple(dependencies),
        evidence=tuple(evidence),
        minecraft_version=minecraft_version,
        loader_version=loader_versions[0] if loader_versions else None,
        build_systems=tuple(build_systems),
        gradle_version=gradle_version,
        gradle_plugins=tuple(gradle_plugins),
        dependency_versions=tuple(dependency_versions),
        confidence=confidence,
    )
