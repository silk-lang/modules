# Selecting callers on the HTTP request path

The default JIT used 760,422 guest instructions per order. Enabling compiled calls only for 15 functions on the parser and listener path used 769,581 (+1.20%). Enabling calls globally used 926,163 (+21.80%). These are Callgrind instruction counts from one fresh process per condition, run on x86_64 Linux. The earlier debugger-free counts on the same release were 756,377 and 924,531 for the default and global controls respectively. [Earlier fixed-work measurements](../../2026-11-18-http-service/)

| Call policy | Instructions/order | Instructions/order in the compiler hook | Hot reports with calls enabled / all reports | New entries in the measured window |
| --- | ---: | ---: | ---: | ---: |
| Default | 760,422 | 7,907 | 0 / 244 | 5 |
| Selected functions | 769,581 | 8,618 | 44 / 269 | 6 |
| Global | 926,163 | 62,177 | 509 / 509 | 15 |

Each guest processed 4,800 warm orders, then 400 measured orders and a shutdown request over one keep-alive connection. The client verified every status and exact response body using four rotating 64-item orders. LLDB applied the policy at every entry into `jitHotFunction` and read the flag back after every write. It stayed attached until guest shutdown. Every condition enabled compiler diagnostics during warmup. At the measurement boundary LLDB disabled the guest's compiler dump and collected entry counters. Callgrind counted guest instructions throughout the measured window, including later compilations. Subtracting the inclusive compiler-hook cost still leaves a 1.12% selective increase over default. [Entry counters, checksums and raw measured totals](result.json)

An independent clean run of the packaged launcher verified another 15,600 order responses and all three shutdowns. Its default, selective and global counts were 755,748, 768,079 and 922,622 instructions per order. Selection cost 1.63% over default and global calls cost 22.08%. Across its 244, 269 and 527 hot reports, the gate enabled calls 0, 43 and 527 times. The selective `emit` again ran 4,000 times without a deopt.

The selective policy identified the native parser's `event` and `callback`, its event arrow and three call wrappers, three `_http_common` callbacks, `_http_server.parserOnIncoming`, `events.emit`, and four functions in the application. It matched module and function identity, using exact debug-source spans for arrow functions. The shared `emit` function covers every event on which that bytecode runs. [Names, modules and spans](gate.py)

With selection active, `emit` ran in native code 4,000 times without a deopt during measurement. `call1` ran 800 times and `call0` ran 400 times. The parser's named `event` and `callback` both installed earlier and recorded zero native runs during measurement. The application request and end listeners failed compilation. Selecting these callers left dependencies outside the selected set.

## Refusal evidence

The selective dumps report “it calls a function that stays interpreted” for all five callers below. The engine collapses observed codeless targets into one refusal reason. The measured capture retained that reason and its caller, without the corresponding feedback cells. A separate full-lifetime trace of the same release with global calls observed the following call targets at these bytecode PCs. They narrow the candidate sites for each caller. The decisive target of each selective refusal remains unresolved. [Refusal in the compiler](../../../../../modules/jit/src/jit_runtime.silk)

| Refused caller in the selective run | Call targets observed in the independent global-calls trace |
| --- | --- |
| `parserOnHeadersComplete` | 146 `IncomingMessage`, 404 `_addHeaderLines` |
| `parserOnIncoming` | 6 `resetSocketTimeout`, 268 `ServerResponse`, 539 `assignSocket`, 579 `addListener`, 1130 `emit` |
| Application request listener | 88, 105 and 122 had anonymous bytecode targets |
| `parserOnMessageComplete` | 114 `pushEnd`, 133 `readStart` |
| Application end listener | 33 `setHeader`, 90 `totalCents`, 99 `end` |

`callRequestHead` emitted the more specific “too many call arguments: call_method” in both call-enabled conditions. Its call forwards the HTTP header arguments to the parser callback.

## Reproduction

Use the Linux x86_64 release embed host for source `62790abf53dae378f36990368c6642aa0f66e777`. Its SHA-256 is `4598cbc914306531c7d7423f9d34e3ba17e46ae98bd23df7144d8a667da6a07e`. The fixed executable addresses and object layouts in the debugger hook are specific to this ELF. The runner verifies its digest and the service fixture digest before launch. The captured tool versions were Valgrind 3.24.0 and LLDB 22.1.8.

From this directory, provide the archived binary and a fresh output directory. `--valgrind`, `--vgdb` and `--lldb` accept explicit tool paths. For a standalone LLDB distribution the optional environment variables `LLDB_PYTHONHOME` and `LLDB_LD_LIBRARY_PATH` apply only to the debugger subprocess.

```sh
python3 run.py --host /path/to/silkjs-jit-embed-smoke --out /tmp/http-call-selection
python3 report.py /tmp/http-call-selection
```

The runner saves every applied flag, module, bytecode identity, raw Callgrind dump, compilation log and before/after native entry table. The reporter verifies that table growth between consecutive reports accounts for all installed entries and agrees with the entry indexes printed in the warmup dump. It reports native runs and OSR runs separately. Feedback sampling, unlinking and recompile countdowns can change which entries are active in a fresh process.
