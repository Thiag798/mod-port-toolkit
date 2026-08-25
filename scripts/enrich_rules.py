from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "knowledge-base" / "rules"

METADATA: dict[str, dict[str, object]] = {
    "flattening-block-grass": {"category": "BLOCKS", "breaking_change": True, "migration_type": "registry_rename", "replacement_api": "Blocks.GRASS_BLOCK"},
    "resource-folders-plural-to-singular": {"category": "RESOURCES", "breaking_change": True, "migration_type": "resource_path", "replacement_api": "caminhos singulares de resources/data"},
    "lang-properties-to-json": {"category": "RESOURCES", "breaking_change": True, "migration_type": "format_change", "replacement_api": "JSON de traduções"},
    "commands-brigadier": {"category": "COMMANDS", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "Brigadier builders"},
    "tile-entity-to-block-entity": {"category": "BLOCK_ENTITIES", "breaking_change": True, "migration_type": "api_rename", "replacement_api": "BlockEntity/EntityBlock", "requires_ast": True},
    "forge-capability-inject-to-token": {"category": "CAPABILITIES", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "CapabilityToken", "requires_ast": True},
    "forge-tooltype-redesign": {"category": "ITEMS", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "tiers e ToolAction", "requires_ast": True},
    "java-16-required": {"category": "BUILD_CONFIG", "breaking_change": True, "migration_type": "runtime_requirement", "replacement_api": "Java 16"},
    "java-21-required": {"category": "BUILD_CONFIG", "breaking_change": True, "migration_type": "runtime_requirement", "replacement_api": "Java 21"},
    "neoforge-metadata-file": {"category": "METADATA", "breaking_change": True, "migration_type": "metadata_path", "replacement_api": "neoforge.mods.toml"},
    "item-components-transition": {"category": "ITEMS", "breaking_change": True, "migration_type": "data_model", "replacement_api": "Data Components", "requires_ast": True},
    "resourcelocation-constructor-private": {"category": "IDENTIFIERS", "breaking_change": True, "migration_type": "api_visibility", "replacement_api": "ResourceLocation.parse/fromNamespaceAndPath", "requires_ast": True},
    "singular-resource-folders-1-21": {"category": "RESOURCES", "breaking_change": True, "migration_type": "resource_path", "replacement_api": "caminhos singulares de resources/data"},
    "vertex-consumer-api-1-21": {"category": "RENDERING", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "VertexConsumer.addVertex/setColor/setUv", "requires_ast": True},
    "gui-component-to-graphics": {"category": "GUI", "breaking_change": True, "migration_type": "api_rename", "replacement_api": "GuiGraphics", "requires_ast": True},
    "recipe-input-replaces-container": {"category": "RECIPES", "breaking_change": True, "migration_type": "type_change", "replacement_api": "RecipeInput", "requires_ast": True},
    "portal-info-to-dimension-transition": {"category": "DIMENSIONS", "breaking_change": True, "migration_type": "type_change", "replacement_api": "DimensionTransition", "requires_ast": True},
    "record-item-to-jukebox-playable": {"category": "ITEMS", "breaking_change": True, "migration_type": "data_model", "replacement_api": "JukeboxPlayable", "requires_ast": True},
    "neoforge-event-result-removed": {"category": "EVENTS", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "API de cancelamento/resultado do evento", "requires_ast": True},
    "neoforge-tool-actions-to-item-abilities": {"category": "ITEMS", "breaking_change": True, "migration_type": "api_rename", "replacement_api": "ItemAbilities", "requires_ast": True},
    "neoforge-plant-type-replaced": {"category": "BLOCKS", "breaking_change": True, "migration_type": "contract_change", "replacement_api": "contrato atual de planta", "requires_ast": True},
    "neoforge-networking-api-rework": {"category": "NETWORKING", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "payloads/codecs do NeoForge 21", "requires_ast": True},
    "neoforge-capability-rework": {"category": "CAPABILITIES", "breaking_change": True, "migration_type": "api_redesign", "replacement_api": "Data Attachments/capability vigente", "requires_ast": True},
    "fabric-yarn-to-mojang-mappings": {"category": "MAPPINGS", "breaking_change": True, "migration_type": "mapping_change", "replacement_api": "Mojang Mappings"},
}


def yaml_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return '"' + str(value).replace('"', '\\"') + '"'


def block_metadata(rule_id: str, metadata: dict[str, object]) -> str:
    lines = [
        f"    category: {yaml_scalar(metadata['category'])}",
        f"    breaking_change: {yaml_scalar(metadata['breaking_change'])}",
        f"    migration_type: {yaml_scalar(metadata['migration_type'])}",
        f"    replacement_api: {yaml_scalar(metadata['replacement_api'])}",
        "    automatable: false",
        "    automation_safety: manual_review",
    ]
    if metadata.get("requires_ast"):
        lines.append("    requires_ast: true")
    return "\n".join(lines) + "\n"


def enrich_file(path: Path) -> tuple[int, set[str]]:
    text = path.read_text(encoding="utf-8")
    changed = 0
    found: set[str] = set()
    pieces = re.split(r"(?=^  - id: )", text, flags=re.MULTILINE)
    output: list[str] = []
    for piece in pieces:
        match = re.match(r"^  - id: ([^\n]+)\n", piece)
        if not match:
            output.append(piece)
            continue
        rule_id = match.group(1).strip()
        metadata = METADATA.get(rule_id)
        if metadata is None:
            output.append(piece)
            continue
        found.add(rule_id)
        if re.search(r"^    category:", piece, flags=re.MULTILINE):
            output.append(piece)
            continue
        match_in = re.search(r"^    match_in: [^\n]+\n", piece, flags=re.MULTILINE)
        if match_in is None:
            raise SystemExit(f"Regra sem match_in para enriquecimento: {rule_id} em {path}")
        replacement = match_in.group(0) + block_metadata(rule_id, metadata)
        output.append(piece[:match_in.start()] + replacement + piece[match_in.end():])
        changed += 1
    path.write_text("".join(output), encoding="utf-8")
    return changed, found


def main() -> None:
    total = 0
    found: set[str] = set()
    for path in sorted(RULES.glob("*.yaml")):
        changed, file_found = enrich_file(path)
        total += changed
        found.update(file_found)
        print(f"{path.name}: {changed} regra(s) enriquecida(s)")
    missing = sorted(set(METADATA) - found)
    if missing:
        raise SystemExit("IDs esperados não encontrados: " + ", ".join(missing))
    print(f"Total: {total} regra(s) enriquecida(s).")


if __name__ == "__main__":
    main()
