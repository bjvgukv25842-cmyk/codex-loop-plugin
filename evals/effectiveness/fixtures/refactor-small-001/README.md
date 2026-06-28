# Report Builder

Fixture for M12 refactor-small-001.

The public API exports:

- `buildSummaryReport(data)`
- `buildDetailedReport(data)`
- `buildCsvReport(data)`

The initial behavior is correct, but `src/report-builder.js` intentionally repeats formatting and status mapping logic. The refactor task should centralize that shared logic without changing public output.
