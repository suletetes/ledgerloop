# test

Test root for LedgerLoop.

The Vitest + fast-check + axe-core harness and the base property-test
generators are set up in task 1.2. This directory holds:

- property-based tests (`fast-check`, ≥100 iterations, one test per design
  Property, tagged `Feature: ledgerloop-app, Property {n}: {text}`)
- unit / example tests
- shared generators and test helpers

It is created here as part of the project scaffold (task 1.1) so the layered
structure — `src/domain`, `src/ledger`, `src/app`, `src/components`, `test` —
exists from the start.
