# M12 bugfix-small-001 target

Fixture for the M12 bugfix canary runner.

The starting implementation intentionally has pagination boundary bugs:

- It reports a next page when `currentPage === totalPages`.
- It accepts invalid page numbers.

The expected fix is scoped to `src/pagination.js`.
