# JIT kernels

Small fixed-work programs, one feature each, for `scripts/jit_kernels.py`. Each file defines
`UNITS` (inner iterations of its work) and `kernel()`, which returns a checksum that every engine
must agree on. The runner prepends a clock and times one `kernel()` call inside the process, so
startup is excluded but compilation and warmup are not. See `docs/jit/jit-scorecard.md`.
