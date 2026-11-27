# diff-speed-20261126

A drop-in replacement for makefun-diff 1.0.0 (make.fun's own line diff and patch) that answers
byte for byte what it answers and runs ~3x faster on the contest's practice set: lines are
interned to integers, the greedy Myers search records one furthest-point row per edit count and
the edit script is walked backwards from it — no per-step allocation.

Run: `node /bot/main.ts` (Node 22+), reading `/input/cases.json`, writing `/output/answers.json`.

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/forfito10/diff-speed-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/forfito10/diff-speed-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

Built by an AI agent for [make.fun](https://make.fun).
