#!/usr/bin/env python3
"""results/*.jsonl -> results/summary.json: one row per session, suite, app, scene, metric and
step, with the median over the session's runs and its spread. The comparison page reads this file.

  tools/summarize.py [results dir]

Start time: `first_paint_warm` is the median of the warm runs, `first_paint_cold` the cold run(s).
Every other metric is the median over all runs of the session (METRICS.md).
"""
import json, os, statistics, sys
from collections import defaultdict

XB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(XB, "results")


def version_of(rec):
    v = rec.get("versions", {}).get(rec["app"])
    if isinstance(v, dict):
        keep = [f"{k} {v[k]}" for k in ("silkui", "loom", "electron", "rune", "gpui", "ferroui") if v.get(k)]
        return ", ".join(keep)
    return v or ""


def main():
    groups = defaultdict(list)
    for name in sorted(os.listdir(RESULTS)):
        if not name.endswith(".jsonl") or name.endswith("-timeline.jsonl"):
            continue
        for line in open(os.path.join(RESULTS, name)):
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            groups[(rec["session"], rec["suite"], rec["app"], rec["scene"])].append(rec)

    rows = []
    for (session, suite, app, scene), recs in sorted(groups.items()):
        first = recs[0]
        base = {
            "session": session, "date": session[:10], "suite": suite, "app": app, "scene": scene,
            "machine": first["machine"].get("host", ""), "cpu": first["machine"].get("cpu", ""),
            "appearance": first["machine"].get("appearance", ""), "label": first.get("label", ""),
            "version": version_of(first),
        }
        values = defaultdict(list)  # (metric, step, unit) -> [values]

        for r in recs:
            fp = r.get("first_paint_ms")
            if fp is not None:
                values[("first_paint_" + r["kind"], "", "ms")].append(fp)
            if r.get("mode") == "start":
                continue
            for step, d in r.get("drivers", {}).items():
                if d.get("frame_ms") is not None:
                    values[("frame_ms", step, "ms")].append(d["frame_ms"])
                if d.get("cpu_ms_per_frame") is not None:
                    values[("cpu_ms_per_frame", step, "ms")].append(d["cpu_ms_per_frame"])
                iv = d.get("intervals")
                if iv:
                    values[("interval_p95", step, "ms")].append(iv["p95"])
                    values[("interval_p99", step, "ms")].append(iv["p99"])
                    values[("interval_max", step, "ms")].append(iv["max"])
                    values[("over_16_7", step, "frames")].append(iv["over_16_7"])
            for step, m in r.get("marks", {}).items():
                if m.get("mb") is not None:
                    values[("memory_mb", step, "MB")].append(m["mb"])
            for step, i in r.get("idle", {}).items():
                if i.get("meaningful", True) and i.get("cpu_pct") is not None:
                    values[("idle_cpu_pct", step, "%")].append(i["cpu_pct"])

        for (metric, step, unit), vs in sorted(values.items()):
            rows.append({**base, "metric": metric, "step": step, "unit": unit,
                         "value": round(statistics.median(vs), 3), "lo": round(min(vs), 3), "hi": round(max(vs), 3), "n": len(vs)})

    out = os.path.join(RESULTS, "summary.json")
    with open(out, "w") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n]\n")
    print(out, len(rows), "rows")


if __name__ == "__main__":
    main()
