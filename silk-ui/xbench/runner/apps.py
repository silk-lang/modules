"""The implementations the runner knows: how to start each one for a scene, in each suite.

An app entry is a function (scene, suite, uncapped) -> Launch, or None when the app does not run
in that suite. `suite` is "cpu" (windowless, no GPU: layout, paint preparation, memory) or "gpu"
(a real window on a real display, presenting frames). LOG.md says what each app does differently.
"""
import os, platform
from dataclasses import dataclass, field

XB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS = os.path.join(XB, "apps")
MAC = platform.system() == "Darwin"
TRIPLE = ("aarch64-apple-darwin" if platform.machine() == "arm64" else "x86_64-apple-darwin") if MAC else "x86_64-unknown-linux-gnu"


@dataclass
class Launch:
    cmd: list
    env: dict = field(default_factory=dict)
    cwd: str = XB
    # Files the app reads at start (binary, bundle, libraries), evicted from the page cache for a
    # cold start on Linux. Directories are walked.
    files: list = field(default_factory=list)
    # The process to measure is a wrapper's child (xvfb-run): measure the whole tree under it.
    tree: bool = True
    # The app's own per-frame timestamps follow a fake clock (Silk's windowless bench advances
    # 1/120 s a frame): only the runner's wall clock times its frames.
    fake_clock: bool = False
    # Directories deleted before a cold start: the app's GPU, shader and code caches, so a cold
    # launch rebuilds its pipelines the way a first launch does.
    caches: list = field(default_factory=list)


HOME = os.path.expanduser("~")
SILK_GPU_CACHE = (os.path.join(HOME, "Library/Caches/silk-ui/gpu") if MAC
                  else os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(HOME, ".cache"), "silk-ui/gpu"))
ELECTRON_USER_DATA = (os.path.join(HOME, "Library/Application Support/xbench-electron") if MAC
                      else os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config"), "xbench-electron"))
ELECTRON_CACHES = [os.path.join(ELECTRON_USER_DATA, d) for d in
                   ("GPUCache", "Code Cache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "Cache")]


def silk_build(name, scene):
    """Silk packages build one binary per scene into build-<scene>/ (apps/<name>/build.sh)."""
    return os.path.join(APPS, name, "out", scene, name)


def silk_launch(name, scene, suite, uncapped):
    binary = silk_build(name, scene)
    if suite == "cpu":
        # SILK_UI_BENCH runs frames back to back with no window, display or GPU, on a clock that
        # moves 1/120 s a frame; the frame count only needs to outlast the scene (the runner
        # stops the app at "XB done").
        env = {"SILK_UI_HEADLESS": "1", "SILK_UI_BENCH": "1000000"}
        return Launch([binary, scene], env, cwd=os.path.dirname(binary), files=[os.path.dirname(binary)], fake_clock=True)
    env = {"SILK_UI_UNCAPPED": "1"} if uncapped else {}
    # The running total of frames the window showed, for drivers' `shown` (METRICS.md).
    env["SILK_UI_TRACE_PRESENTS"] = "1"
    # macOS can report a window on screen as covered for a few seconds, which pauses its frames.
    # Electron runs with occlusion throttling off (xbench/apps/electron/main.cjs); this is the same switch.
    env["SILK_WINDOW_IGNORE_OCCLUSION"] = "1"
    if scene.startswith("canvas"):
        # One line on stderr says whether canvas frames reached the window without a copy
        # (the record keeps it as canvas_path).
        env["SILK_UI_TRACE_CANVAS"] = "1"
    return Launch([binary, scene], env, cwd=os.path.dirname(binary), files=[os.path.dirname(binary)], caches=[SILK_GPU_CACHE])


def electron(scene, suite, uncapped):
    base = os.path.join(APPS, "electron")
    exe = (os.path.join(base, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron") if MAC
           else os.path.join(base, "node_modules/electron/dist/electron"))
    if not os.path.exists(exe):
        raise SystemExit(f"electron: no binary at {exe}. After npm ci, run node node_modules/electron/install.js in apps/electron.")
    env = {"XB_SCENE": scene}
    if uncapped:
        env["XB_UNCAPPED"] = "1"
    cmd = [exe, base]
    if not MAC:
        cmd.insert(1, "--no-sandbox")
    if suite == "cpu":
        # Offscreen rendering with no GPU: Chromium still rasterizes, in software, which the Silk
        # bench does not do at all (LOG.md).
        env["XB_WINDOWLESS"] = "1"
        cmd += ["--disable-gpu", "--disable-gpu-compositing"]
    if not MAC:
        cmd = ["xvfb-run", "-a", "-s", "-screen 0 1280x800x24"] + cmd
    files = [os.path.dirname(exe), os.path.join(APPS, "react", "web", "dist-web", scene)]
    return Launch(cmd, env, cwd=base, files=files, caches=ELECTRON_CACHES)


def rust(name, binary):
    def launch(scene, suite, uncapped):
        exe = os.path.join(APPS, name, "target", "release", binary)
        env = {"XB_SUITE": suite}
        if uncapped:
            env["XB_UNCAPPED"] = "1"
        cmd = [exe, scene]
        if suite == "gpu" and not MAC:
            cmd = ["xvfb-run", "-a", "-s", "-screen 0 1280x800x24"] + cmd
        # The cpu suite runs frames back to back on a clock that moves 1/120 s a frame, as Silk
        # UI's windowless bench does: only the runner's wall clock times its frames.
        return Launch(cmd, env, cwd=os.path.join(APPS, name), files=[exe], fake_clock=suite == "cpu")
    return launch


APP_TABLE = {
    "electron": electron,
    "silk-react": lambda s, su, u: silk_launch("silk-react", s, su, u),
    "silk-loom": lambda s, su, u: silk_launch("silk-loom", s, su, u),
    "silk-direct": lambda s, su, u: silk_launch("silk-direct", s, su, u),
    "gpui": rust("gpui", "xbench-gpui"),
    "rune": rust("rune", "xbench-rune"),
    "ferroui": rust("ferroui", "xbench-ferroui"),
}
