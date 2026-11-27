import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import jit_parity


class ParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "requires Node")
    def test_measures_both_phases_against_the_macro_oracle(self):
        commands = {name: [shutil.which("node")] for name in ("silkjs", "v8")}
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            result = jit_parity.compare(commands, {"json": "1720240\n"}, 2, 1, 2,
                                        Path(temp), jit_parity.environment(), 30)
        for metric in ("cold_ms", "repeated_ms_per_call"):
            row = result["json"][metric]
            self.assertEqual([len(values) for values in row["samples"].values()], [2, 2])
            self.assertGreater(row["median_paired_ratio"], 0)

    def test_rejects_wrong_warmup_output_even_if_timed_output_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "output.py"
            path.write_text("print('wrong\\nok\\n__parity_total_ms__ 3')\n")
            with self.assertRaisesRegex(ValueError, "stdout"):
                jit_parity.measure([sys.executable], path, "ok\n", (1, 1), jit_parity.environment(), 10)


if __name__ == "__main__":
    unittest.main()
