export function rangesOverlap(first, second) {
  return first.start <= second.end && second.start <= first.end;
}
