# CPU sampled across the HTTP request

The original 64-item order service took more server CPU with compiled calls enabled. In the follow-up pair with clear CPU lanes, the default used 226.8 µs per order and `--jit-calls` used 340.7 µs. Across all five measured pairs the interpreter dispatch loop took less CPU, while generated machine code, VM call handling and JIT helpers took more. [Per-window measurements and function rankings](receipt.json)

| Exclusive CPU, µs/order | Three longer pairs, median difference | Two follow-up pairs, median difference |
| --- | ---: | ---: |
| Whole server process | +115.7 | +104.2 |
| Generated machine code | +34.4 | +43.0 |
| VM functions in `js_vm.silk` outside `executeLoop` | +22.4 | +20.8 |
| JIT helpers in `jit_helpers.silk` | +13.2 | +12.6 |
| Interpreter `executeLoop` | −8.3 | −18.0 |
| System CPU | +17.1 | +11.3 |

The native function with the largest median increase in both sets was `jitGetScope`, adding 4.9 and 4.3 µs/order. Other repeatedly higher costs included `callForCompiled`, `activationCall`, `runActivations` and `callPlain`. Across the five calls-on windows, 475 instruction samples landed in `jitGetScope`. Of those, 123 landed at its ordinary scope slot payload load and 93 at the result store. The sampled PCs identify the executed path. Hardware and software interrupt delivery can shift the precise instruction recorded. Generated code matching `processTicksAndRejections`, `nextTick`, `emit` and HTTP parser functions also received samples. The rankings contain exclusive time at the sampled instruction. Inclusive listener and callee costs require a stack profile. The table shows selected categories, and each difference is a median over paired runs. [Complete counts](windows.json.gz)

The captured machine code also resolves entry, resume, call-boundary value transfers and native stack traffic for each sampled generated instruction. [Generated x86-64 instruction analysis](generated-ops.md)

## Measurement

The x86-64 host was built at `62790abf53dae378f36990368c6642aa0f66e777`. Each run pinned the server to CPU 0 and the client to CPU 1, warmed the original fixture with 4,800 verified orders, then sampled the server's thread while continuing to verify every response. The three longer pairs measured 24,000 orders per mode. They overlapped a release build to varying degrees. The follow-up measured 8,000 orders per mode. Its first pair had clear CPU lanes in both modes. During the second pair another Callgrind process appeared around the end of the default window and overlapped the calls-on window. The two follow-up pairs each reversed the order of the modes. Their total CPU differences were +113.9 and +94.4 µs/order.

The Linux software task-clock event recorded 49,135 user-space instruction pointers across ten HTTP windows. Kernel task-clock time agreed with the independently read process CPU clock to within 0.5%. Sample counts multiplied by their periods represented 97.3–100.4% of user CPU from `/proc`. Every window had a single service thread, zero lost samples and zero throttle records. The sampler used periods of approximately 0.734, 1.000 and 1.280 ms. It allocated the measured user CPU to functions in proportion to their sample counts. System CPU was measured separately. A two-function compute control recorded 1,157 samples in 1.20 s of CPU. Of 1,149 samples in its two hot loops, 77.8% fell in the loop called three times for every call to the other.

Native addresses resolve through the sampled process's executable mappings, ELF load segments, function symbols and the embedding host's Silk symbol sidecar. For the recorded host only, generated code is named if its entire machine-code body matches a unique function label from an independent diagnostic trace on the same ELF. Unmatched executable pages remain visible in the results. The pinned binary's SHA-256 and the two source trace hashes accompany the signature map. [Generated code signatures](generated-signatures.json.gz)

## Reproduction

Run on Linux x86-64 with Python 3.11+, a C compiler, binutils and permission to open the user-space `PERF_COUNT_SW_TASK_CLOCK` event for a child. Place the release's `.symbols` sidecar beside the host binary. Choose two available CPUs. The sampler builds its small C reader in a temporary directory.

```sh
dir=docs/jit/jit-scorecard-results/2026-11-19-http-calls/cpu
python3 "$dir/sample.py" control --out /tmp/silk-cpu/control
python3 "$dir/sample.py" default --host "$host" --out /tmp/silk-cpu/default
python3 "$dir/sample.py" calls --host "$host" --out /tmp/silk-cpu/calls
python3 "$dir/report.py" --pair /tmp/silk-cpu/default/result.json /tmp/silk-cpu/calls/result.json
```

Repeat the pair in the opposite order for a counterbalanced comparison. Pass `--period` in nanoseconds to vary the sampling interval. For the shorter follow-up, pass `--orders 8000`. To reproduce the saved aggregate directly, run `python3 "$dir/report.py"`. [Sampler](sample.py) · [Kernel event reader](perf_ring.c) · [Aggregate calculation](report.py)
