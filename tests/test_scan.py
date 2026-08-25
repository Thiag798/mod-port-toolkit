from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from scanner.context import detect_context
from scanner.scan import ToolkitError, read_rules, render_report, scan


ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "knowledge-base" / "rules"
FIXTURE = ROOT / "tests" / "PortSample.java"


class ScannerTests(unittest.TestCase):
    def test_real_rules_load_with_nested_yaml(self) -> None:
        rules = read_rules(RULES)
        ids = {rule.rule_id for rule in rules}
        self.assertTrue({"commands-literal-wrapper", "flattening-block-grass", "model-event-change"}.issubset(ids))
        by_id = {rule.rule_id: rule for rule in rules}
        self.assertEqual(by_id["model-event-change"].confidence, 0.85)
        self.assertEqual(by_id["model-event-change"].loaders, ("forge", "neoforge"))
        self.assertEqual(by_id["flattening-block-grass"].patterns, (r'\bBlocks\.GRASS\b|\bBlocks\.grass\b|"minecraft:grass"',))

    def test_scan_filters_context_and_ignores_comments(self) -> None:
        rules = read_rules(RULES)
        result = scan(
            ROOT / "tests",
            rules,
            source_version="1.12.2",
            target_version="1.20.1",
            loader="forge",
        )
        pairs = {(finding.rule.rule_id, finding.line_number) for finding in result.findings}
        self.assertEqual(
            pairs,
            {
                ("commands-literal-wrapper", 10),
                ("commands-brigadier", 10),
                ("flattening-block-grass", 7),
                ("flattening-block-grass", 11),
            },
        )
        self.assertTrue(all(finding.line_number != 3 for finding in result.findings))
        self.assertTrue(all(finding.line_number != 4 for finding in result.findings))
        skipped = {item.rule.rule_id: item.reason for item in result.skipped_rules}
        self.assertIn("model-event-change", skipped)
        self.assertEqual(result.files_seen, 3)

    def test_version_and_loader_context_applies_model_rule(self) -> None:
        rules = read_rules(RULES)
        result = scan(
            FIXTURE,
            rules,
            source_version="1.20.1",
            target_version="1.21.1",
            loader="neoforge",
        )
        matches = {(finding.rule.rule_id, finding.line_number) for finding in result.findings}
        self.assertIn(("model-event-change", 12), matches)
        self.assertNotIn("model-event-change", {item.rule.rule_id for item in result.skipped_rules})

    def test_loader_filter_skips_rule(self) -> None:
        rules = read_rules(RULES)
        result = scan(
            FIXTURE,
            rules,
            source_version="1.20.1",
            target_version="1.21.1",
            loader="fabric",
        )
        skipped = {item.rule.rule_id: item.reason for item in result.skipped_rules}
        self.assertEqual(skipped["commands-literal-wrapper"], "loader fora do conjunto da regra")
        self.assertEqual(skipped["model-event-change"], "loader fora do conjunto da regra")
        self.assertFalse(any(item.rule.rule_id == "commands-literal-wrapper" for item in result.findings))

    def test_report_contains_context_confidence_and_skipped_rules(self) -> None:
        rules = read_rules(RULES)
        result = scan(
            FIXTURE,
            rules,
            source_version="1.12.2",
            target_version="1.20.1",
            loader="forge",
        )
        report = render_report(
            "PortSample",
            FIXTURE,
            "1.12.2",
            "1.20.1",
            "forge",
            rules,
            result,
        )
        self.assertIn("Confiança editorial:", report)
        self.assertIn("95%", report)
        self.assertIn("Regras não aplicadas por contexto", report)
        self.assertIn("Linha/coluna:", report)
        self.assertIn("Condição adicional:", report)
        self.assertIn("somente leitura", report)

    def test_invalid_regex_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.yaml"
            path.write_text("rules:\n  - id: bad\n    pattern: '['\n", encoding="utf-8")
            rules = read_rules(path)
            with self.assertRaises(ToolkitError):
                scan(
                    FIXTURE,
                    rules,
                    source_version=None,
                    target_version="1.20.1",
                    loader=None,
                )

    def test_non_java_individual_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "readme.txt"
            path.write_text("text", encoding="utf-8")
            with self.assertRaises(ToolkitError):
                scan(
                    path,
                    [],
                    source_version=None,
                    target_version="1.20.1",
                    loader=None,
                )

    def test_invalid_yaml_schema_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.yaml"
            path.write_text(
                "rules:\n  - id: invalid\n    pattern:\n      - x\n    unknown_field: true\n",
                encoding="utf-8",
            )
            with self.assertRaises(ToolkitError):
                read_rules(path)

    def test_context_detector_is_static_and_reports_evidence(self) -> None:
        context = detect_context(ROOT / "tests" / "context-project")
        self.assertEqual(context.loader, "neoforge")
        self.assertEqual(context.java_version, "21")
        self.assertIn("parchment", context.mappings)
        self.assertIn("jei", context.dependencies)
        self.assertIn("curios", context.dependencies)
        self.assertTrue(any("neoforge" in item for item in context.evidence))

    def test_source_is_not_modified(self) -> None:
        before = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
        rules = read_rules(RULES)
        scan(
            FIXTURE,
            rules,
            source_version="1.12.2",
            target_version="1.20.1",
            loader="forge",
        )
        after = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
