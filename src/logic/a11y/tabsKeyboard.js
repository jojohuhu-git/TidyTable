// B12: standard ARIA tablist arrow-key navigation (Left/Right/Home/End) —
// pure so the wraparound logic is unit-testable without rendering a component.
export function nextTabIndex(key, currentIndex, count) {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (currentIndex + 1) % count;
  if (key === "ArrowLeft") return (currentIndex - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
