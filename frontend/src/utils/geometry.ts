import polygonClipping from 'polygon-clipping';

type Pair = [number, number];
type Ring = Pair[];
type MultiPoly = Ring[][];

function toRing(pts: number[][]): Ring {
  return pts.map(p => [p[0], p[1]] as Pair);
}

function fromRing(ring: Ring): number[][] {
  return ring.map(p => [p[0], p[1]]);
}

/** Extract all outer rings from a polygon-clipping multi-polygon result. */
function fromMultiPoly(result: MultiPoly): number[][][] {
  return result
    .filter(poly => poly && poly.length > 0)
    .map(poly => fromRing(poly[0]))
    .filter(ring => ring.length >= 3);
}

/**
 * Union two simple polygons.
 * Returns ALL resulting polygons (multi-polygon), or empty array.
 */
export function unionPolygons(a: number[][], b: number[][]): number[][][] {
  const result = polygonClipping.union([toRing(a)], [toRing(b)]);
  return fromMultiPoly(result as MultiPoly);
}

/**
 * Union multiple polygons together (for merging shapes of same label).
 * Returns ALL resulting polygons, or empty array.
 */
export function unionMany(polygons: number[][][]): number[][][] {
  if (polygons.length === 0) return [];
  let result: MultiPoly = [[toRing(polygons[0])]];
  for (let i = 1; i < polygons.length; i++) {
    result = polygonClipping.union(result, [toRing(polygons[i])]) as MultiPoly;
  }
  return fromMultiPoly(result);
}

/**
 * Subtract polygon b from polygon a (a - b).
 * Returns ALL resulting polygons (multi-polygon), or empty array.
 */
export function subtractPolygons(a: number[][], b: number[][]): number[][][] {
  const result = polygonClipping.difference([toRing(a)], [toRing(b)]);
  return fromMultiPoly(result as MultiPoly);
}

/** Euclidean distance between two points */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Shortest distance from point (px, py) to line segment (ax, ay) → (bx, by).
 * Returns the perpendicular distance if the projection falls on the segment,
 * otherwise distance to the nearer endpoint.
 */
export function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) return distance(px, py, ax, ay);

  // Projection parameter t along AB
  let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  // Nearest point on segment
  const nx = ax + t * abx;
  const ny = ay + t * aby;
  return distance(px, py, nx, ny);
}

/**
 * Signed polygon area (positive = counter-clockwise, negative = clockwise).
 */
export function signedArea(points: number[][]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return area / 2;
}

/** Absolute polygon area */
export function polygonArea(points: number[][]): number {
  return Math.abs(signedArea(points));
}

/**
 * True if two polygons overlap (their intersection has non-zero area).
 */
export function polygonsOverlap(a: number[][], b: number[][]): boolean {
  const result = polygonClipping.intersection([toRing(a)], [toRing(b)]);
  const pieces = fromMultiPoly(result as MultiPoly);
  return pieces.some(p => polygonArea(p) > 1e-6);
}

/**
 * Ray-casting: is point (px, py) inside the polygon defined by points?
 * Handles convex and concave polygons.
 */
export function isPointInPolygon(px: number, py: number, points: number[][]): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Compute the centroid of a set of points.
 */
export function centroid(points: number[][]): [number, number] {
  if (points.length === 0) return [0, 0];
  let cx = 0, cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  return [cx / points.length, cy / points.length];
}

/**
 * Distance from a point to the nearest vertex/edge of a polygon.
 * threshold — if within this distance, the point is considered "near" the polygon.
 */
export function pointNearPolygon(
  px: number, py: number,
  points: number[][],
  threshold: number,
): boolean {
  const n = points.length;
  // Check vertices
  for (const [vx, vy] of points) {
    if (distance(px, py, vx, vy) <= threshold) return true;
  }
  // Check edges
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (pointToSegmentDistance(px, py, points[i][0], points[i][1], points[j][0], points[j][1]) <= threshold) {
      return true;
    }
  }
  return false;
}
