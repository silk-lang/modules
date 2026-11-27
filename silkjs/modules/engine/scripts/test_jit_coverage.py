import tempfile
import unittest
from pathlib import Path

from jit_coverage import jit_symbol_groups, per_object


class InstructionAttribution(unittest.TestCase):
    def test_named_and_anonymous_self_costs(self):
        with tempfile.TemporaryDirectory() as tmp:
            shell = Path(tmp) / "shell"
            profile = Path(tmp) / "callgrind.out"
            profile.write_text("""ob=(1) shell
fn=(1) backend
0 10
cfn=(2) helper
calls=1 0
0 25
fn=(2)
0 20
fn=exitState
0 5
fn=driver
0 7
fn=engine
0 8
ob=(2) ???
fn=(3) 0x1234
0 50
""")
            absent = per_object(profile, jit_symbol_groups(str(shell)))
            self.assertIsNone(absent["compiler_fraction"])
            self.assertIsNone(absent["helper_fraction"])
            self.assertEqual(absent["compiled"], 50)
            Path(str(shell) + ".symbols").write_text(
                "backend\tfunction\tsilkjs-jit@0.1.0:x64_backend.silk::emit\n"
                "helper\tfunction\tsilkjs-jit@0.1.0:jit_helpers.silk::jitGetVar\n"
                "exitState\texport\tsilkjs-jit@0.1.0:jit_exit_state.silk::jitExitState\n"
                "driver\tfunction\tsilkjs-jit@0.1.0:jit_runtime.silk::compileHot\n"
                "engine\tfunction\tsilkjs-engine@0.1.0:x64_backend.silk::other\n")
            costs = per_object(profile, jit_symbol_groups(str(shell)))
            self.assertEqual((costs["instructions"], costs["compiled"], costs["compiler"], costs["helpers"]),
                             (100, 50, 10, 25))
            self.assertEqual(costs["helper_fraction"], 0.25)
            profile.write_text("ob=(1) shell\nfn=engine\n0 20\n")
            self.assertEqual(per_object(profile, jit_symbol_groups(str(shell)))["compiler_fraction"], 0)


if __name__ == "__main__":
    unittest.main()
