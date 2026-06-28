# M12 test-coverage-002 target

Fixture for adding cache invalidation regression tests.

The cache implementation is intentionally small and already works. The initial
test suite covers the happy path only, while the coverage contract requires
tests for cache misses and stale cache prevention after updates.
