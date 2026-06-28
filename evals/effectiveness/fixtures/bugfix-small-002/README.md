# M12 bugfix-small-002 target

Fixture for the M12 generic bugfix canary runner.

The starting implementation intentionally has date range overlap bugs:

- It reports adjacent ranges as overlapping.
- It does not consistently reject invalid ranges.

The expected fix is scoped to `src/date-range.js`.
