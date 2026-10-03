type Rectangle = { x: number; y: number; width: number; height: number };

export function rectangleIoU(left: Rectangle, right: Rectangle): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function matchAnnotatedFaces(
  annotations: readonly { entity: string; box: Rectangle }[],
  detections: readonly Rectangle[],
  threshold = 0.3,
): Map<string, number> {
  const edges = annotations.flatMap(({ entity, box }) => detections.flatMap((detection, index) => {
    const iou = rectangleIoU(box, detection);
    return iou >= threshold ? [{ entity, index, iou }] : [];
  })).sort((a, b) => b.iou - a.iou || a.entity.localeCompare(b.entity) || a.index - b.index);
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const edge of edges) {
    if (result.has(edge.entity) || used.has(edge.index)) continue;
    result.set(edge.entity, edge.index);
    used.add(edge.index);
  }
  return result;
}
