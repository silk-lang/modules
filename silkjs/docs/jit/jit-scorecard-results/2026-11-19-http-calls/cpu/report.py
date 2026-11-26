"""Convert exclusive IP sample counts and independent user CPU into microseconds per verified order."""

import argparse
import collections
import gzip
import hashlib
import json
import statistics
from pathlib import Path


def category(name):
    if name.startswith(("[anonymous executable]", "[matching generated JS]")):
        return "Generated machine code"
    if ":js_vm.silk::executeLoop" in name:
        return "VM executeLoop"
    if ":js_vm.silk::" in name:
        return "Other js_vm.silk functions"
    if any(
        tag in name for tag in (":js_activation", ":js_compiled", ":js_vm_activation")
    ):
        return "Activation and compiled engine modules"
    for module, group in [
        ("jit_helpers.silk", "jit_helpers.silk"),
        ("js_gc", "js_gc modules"),
        ("js_vm_property_ops", "js_vm_property_ops.silk"),
        ("js_json", "js_json modules"),
    ]:
        if ":" + module in name:
            return group
    if name.startswith("libc.so.6!"):
        return "libc"
    if name.startswith("silkjs-jit-embed-smoke!"):
        return "All other host functions"
    return "Other platform"


def validate(record):
    count = sum(n for _, n in record["function_samples"])
    threads = list(record["threads"].values())
    if len(threads) != 1 or count != record["samples"] or len(record["tids_end"]) != 1:
        raise ValueError("thread shape or sample totals changed")
    perf = threads[0]
    if perf["lost"] or perf["throttle_records"] or perf["sample_mode"][2] != count:
        raise ValueError("lost, throttled or non-user samples")
    coverage = record["sampled_cpu_s"] / record["user_s"]
    if (
        not 0.85 < coverage < 1.1
        or abs(record["perf_task_clock_vs_proc_clock"] - 1) > 0.005
        or perf["running_ns"] != perf["enabled_ns"]
    ):
        raise ValueError("insufficient task-clock or sampling coverage")
    return coverage


def costs(record):
    scale = record["user_s"] * 1e6 / (record["orders"] * record["samples"])
    groups = collections.Counter()
    functions = {}
    for name, count in record["function_samples"]:
        groups[category(name)] += count * scale
        functions[name] = count * scale
    groups["System CPU"] = record["sys_s"] * 1e6 / record["orders"]
    groups["All user CPU"] = record["user_s"] * 1e6 / record["orders"]
    groups["Process CPU"] = record["process_clock_ns"] / record["orders"] / 1000
    return groups, functions


def comparisons(pairs, part):
    keys = {
        k for row in pairs for mode in ("default", "calls") for k in row[mode][part]
    }
    rows = []
    for name in keys:
        a = [row["default"][part].get(name, 0) for row in pairs]
        b = [row["calls"][part].get(name, 0) for row in pairs]
        differences = [y - x for x, y in zip(a, b)]
        rows.append(
            {
                "name": name,
                "default": round(statistics.median(a), 3),
                "calls": round(statistics.median(b), 3),
                "delta": round(statistics.median(differences), 3),
                "range": [round(min(differences), 3), round(max(differences), 3)],
            }
        )
    return sorted(rows, key=lambda r: (-r["delta"], r["name"]))


def report(windows):
    series = {}
    details = []
    for rec in windows:
        coverage = validate(rec)
        series.setdefault(rec["series"], {}).setdefault(rec["pair"], {})[
            rec["mode"]
        ] = costs(rec)
        details.append(
            {
                k: rec[k]
                for k in (
                    "series",
                    "pair",
                    "mode",
                    "orders",
                    "warmup",
                    "samples",
                    "user_s",
                    "sys_s",
                    "process_clock_ns",
                    "period_ns",
                    "background_jobs_before",
                    "background_jobs_after",
                )
            }
            | {
                "sampled_fraction_of_user_cpu": round(coverage, 5),
                "kernel_task_clock_fraction_of_process_clock": round(
                    rec["perf_task_clock_vs_proc_clock"], 6
                ),
            }
        )
    output = {}
    for name, pairs in series.items():
        sample = list(pairs.values())
        groups = comparisons(sample, 0)
        funcs = comparisons(sample, 1)
        output[name] = {
            "unit": "microseconds per completed order, independent user CPU allocation; delta=median(calls minus default), range=observed pair deltas",
            "groups": groups,
            "largest_increases": funcs[:18],
            "largest_decreases": funcs[-6:][::-1],
        }
    return {"windows": details, "comparisons": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, default=Path(__file__).with_name("windows.json.gz")
    )
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--pair",
        nargs=2,
        action="append",
        metavar=("DEFAULT_RESULT", "CALLS_RESULT"),
        help="Summarize sample.py result.json pairs instead of the saved windows",
    )
    args = parser.parse_args()
    if args.pair:
        windows = []
        for i, paths in enumerate(args.pair, 1):
            for mode, path in zip(("default", "calls"), paths):
                result = json.loads(Path(path).read_text())
                if result["mode"] != mode:
                    raise ValueError("wrong mode in " + path)
                windows.append(
                    result
                    | {
                        "series": "user",
                        "pair": i,
                        "background_jobs_before": None,
                        "background_jobs_after": None,
                    }
                )
        original = {}
    else:
        with gzip.open(args.input, "rt") as source:
            original = json.load(source)
        windows = original["windows"]
    summary = {k: v for k, v in original.items() if k != "windows"} | report(windows)
    if not args.pair:
        summary["input_sha256"] = hashlib.sha256(args.input.read_bytes()).hexdigest()
    output = json.dumps(summary, indent=2) + "\n"
    if args.out:
        args.out.write_text(output)
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
