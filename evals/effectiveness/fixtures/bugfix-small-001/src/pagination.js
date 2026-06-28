export function hasNextPage(currentPage, totalPages) {
  if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages)) {
    return false;
  }
  if (totalPages < 1) {
    return false;
  }
  return currentPage <= totalPages;
}
