Per-domain test files, auto-discovered by tools/verify.mjs.

One file per workstream, so parallel work never collides in a single test file.
Each exports `run({ check, assert, near, V, Q, THREE })` and calls `check(...)`
exactly as verify.mjs does inline.
