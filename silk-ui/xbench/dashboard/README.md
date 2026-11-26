# Comparison page

`index.html` is the page of the xbench results dashboard (https://claude.ai/artifact/5wwahHF5nCLP18xVCr8YnM),
a Claude Data artifact. Its datasets are `summary` (`results/summary.json`) and `timeline` (`results/timeline.json`, TIMELINE.md), each uploaded as a file.

After a benchmark session:

1. `tools/summarize.py` (rewrites `results/summary.json` from every `results/*.jsonl`), and after timeline runs `tools/timeline.py`.
2. Commit the `.jsonl` files, so the history stays in the repository.
3. Ask Claude to upload the new `summary.json` (and `timeline.json`) to the dashboard and point the datasets at them.
