from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path

from scanner.java_ast import parse_java
from scanner.project import ToolkitError, git_compare, load_project_config, render_workspace_json, render_workspace_report, render_workspace_sarif, scan_workspace
from scanner.scan import _fails_threshold

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "context-project"
RULES = ROOT / "knowledge-base" / "rules"


class ProjectAnalysisTests(unittest.TestCase):
    def test_ast_fallback_preserves_lines_after_multiline_comment(self) -> None:
        source = "class Broken {\n/* comentário\n * em várias linhas\n */\nvoid method() {\n"
        structure = parse_java(Path("Broken.java"), source)
        self.assertEqual(structure.parser, "regex-fallback")
        self.assertTrue(any(symbol.name == "method" and symbol.line == 5 for symbol in structure.methods))

    def test_git_revisions_reject_option_injection(self) -> None:
        with self.assertRaises(ToolkitError):
            git_compare(ROOT, "--output=/tmp/unsafe", "HEAD")

    def test_ast_extracts_structural_symbols(self) -> None:
        source = (ROOT / "tests" / "PortSample.java").read_text(encoding="utf-8")
        structure = parse_java(ROOT / "tests" / "PortSample.java", source)
        self.assertEqual(structure.parser, "javalang")
        self.assertTrue(any(symbol.name == "PortSample" for symbol in structure.types))
        self.assertTrue(any(symbol.name == "BakedModelWrapper" for symbol in structure.types) or any("BakedModelWrapper" in symbol.name for symbol in structure.calls))
        self.assertTrue(any("Commands.literal" in symbol.name for symbol in structure.calls))

    def test_project_config_and_suppressions_are_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".mod-port-toolkit.yml"
            path.write_text(
                "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
                "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n"
                "analysis:\n  ast: true\n  dependencies: true\n"
                "severity:\n  fail_on: high\n"
                "ignore:\n  - rule: model-event-change\n    file: PortSample.java\n    line: 12\n    reason: 'Fixture de teste'\n",
                encoding="utf-8",
            )
            config = load_project_config(Path(directory), path)
            self.assertEqual(config.target_loader, "neoforge")
            self.assertEqual(config.suppressions[0].rule, "model-event-change")
            self.assertTrue(config.ast)

    def test_analysis_flags_skip_rules_with_explicit_reason(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / ".mod-port-toolkit.yml"
            config_path.write_text(
                "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
                "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n"
                "analysis:\n  ast: false\n  dependencies: false\n",
                encoding="utf-8",
            )
            config = load_project_config(FIXTURE, config_path)
            result = scan_workspace(FIXTURE, config, RULES)
            skipped = {item.rule.rule_id: item.reason for item in result.skipped_rules}
            self.assertEqual(skipped.get("model-event-change"), "análise AST desabilitada")

    def test_external_suppression_file_is_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".mod-port-toolkit-ignore.yml").write_text(
                "ignore:\n  - rule: sample\n    reason: 'Revisado pelo mantenedor'\n",
                encoding="utf-8",
            )
            config = load_project_config(root)
            self.assertEqual(config.suppressions[0].rule, "sample")
            self.assertEqual(config.suppressions[0].reason, "Revisado pelo mantenedor")

    def test_fail_threshold_uses_configured_severity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / ".mod-port-toolkit.yml"
            config_path.write_text(
                "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
                "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n"
                "severity:\n  fail_on: high\n",
                encoding="utf-8",
            )
            config = load_project_config(FIXTURE, config_path)
            result = scan_workspace(FIXTURE, config, RULES)
        self.assertTrue(_fails_threshold(result, "high"))
        self.assertTrue(_fails_threshold(result, "medium"))
        self.assertTrue(_fails_threshold(result, "info"))

    def test_suppression_removes_only_authorized_finding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / ".mod-port-toolkit.yml"
            config_path.write_text(
                "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
                "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n"
                "ignore:\n  - rule: model-event-change\n    file: src/ContextExample.java\n    line: 5\n    reason: 'Compatibilidade mantida neste fixture'\n",
                encoding="utf-8",
            )
            config = load_project_config(FIXTURE, config_path)
            result = scan_workspace(FIXTURE, config, RULES)
            self.assertFalse(any(item.rule.rule_id == "model-event-change" and item.line_number == 5 for item in result.findings))
            self.assertTrue(any(item.rule.rule_id == "model-event-change" and item.line_number == 6 for item in result.findings))

    def test_workspace_has_evidence_and_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / ".mod-port-toolkit.yml"
            config_path.write_text(
                "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
                "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n",
                encoding="utf-8",
            )
            config = load_project_config(FIXTURE, config_path)
        result = scan_workspace(FIXTURE, config, RULES)
        self.assertGreaterEqual(result.files_seen, 3)
        self.assertGreater(result.total_rules, 0)
        self.assertGreater(result.applicable_rules, 0)
        self.assertTrue(result.context.loader == "neoforge")
        self.assertTrue(result.context.build_systems)
        self.assertTrue(result.context.dependencies)
        self.assertTrue(result.findings)
        self.assertTrue(result.findings[0].evidences)
        self.assertGreaterEqual(result.findings[0].overall_confidence, 0.0)
        report = render_workspace_report(FIXTURE, result)
        self.assertIn("MOD PORT REPORT", report)
        self.assertIn("Evidências e sugestões", report)
        self.assertIn("Cobertura conhecida", report)
        self.assertIn("não significa compatibilidade total", report)

    def test_machine_reports_are_read_only_and_structured(self) -> None:
        config = load_project_config(FIXTURE)
        result = scan_workspace(FIXTURE, config, RULES)
        payload = json.loads(render_workspace_json(FIXTURE, result))
        sarif = json.loads(render_workspace_sarif(FIXTURE, result))
        self.assertTrue(payload["read_only"])
        self.assertEqual(payload["phase5"], "excluded")
        self.assertIn("findings", payload)
        self.assertEqual(sarif["version"], "2.1.0")

    def test_project_limits_are_applied(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.java").write_text("class A {}", encoding="utf-8")
            (root / "b.java").write_text("class B {}", encoding="utf-8")
            config_path = root / ".mod-port-toolkit.yml"
            config_path.write_text("analysis:\n  max_files: 1\n  max_file_size: 100\n", encoding="utf-8")
            config = load_project_config(root, config_path)
            self.assertEqual(config.max_files, 1)
            self.assertEqual(scan_workspace(root, config, RULES).files_seen, 1)


if __name__ == "__main__":
    unittest.main()
