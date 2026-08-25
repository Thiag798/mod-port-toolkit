from __future__ import annotations

import json
import subprocess  # nosec B404 - testes de integração invocam somente o scanner local
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "context-project"
RULES = ROOT / "knowledge-base" / "rules"


class ProjectCliTests(unittest.TestCase):
    def _config(self, directory: Path) -> Path:
        config = directory / ".mod-port-toolkit.yml"
        config.write_text(
            "source:\n  minecraft: '1.20.1'\n  loader: forge\n"
            "target:\n  minecraft: '1.21.1'\n  loader: neoforge\n"
            "severity:\n  fail_on: high\n",
            encoding="utf-8",
        )
        return config

    def test_audit_writes_report_and_honors_fail_on(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "audit.md"
            config = self._config(Path(directory))
            completed = subprocess.run(  # nosec B603 - executa o scanner local sem shell
                [sys.executable, str(ROOT / "scanner" / "scan.py"), "audit", "--project", str(FIXTURE), "--config", str(config), "--rules", str(RULES), "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 1, completed.stdout + completed.stderr)
            self.assertTrue(output.exists())
            self.assertIn("MOD PORT REPORT", output.read_text(encoding="utf-8"))

    def test_coverage_writes_json_without_failure_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "coverage.json"
            config = self._config(Path(directory))
            completed = subprocess.run(  # nosec B603 - executa o scanner local sem shell
                [sys.executable, str(ROOT / "scanner" / "scan.py"), "coverage", "--project", str(FIXTURE), "--config", str(config), "--rules", str(RULES), "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertGreater(data["total_rules"], 0)
            self.assertGreater(data["applicable_rules"], 0)


if __name__ == "__main__":
    unittest.main()
