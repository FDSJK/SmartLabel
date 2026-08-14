import polygonClipping from 'polygon-clipping';

type Pair = [number, number];
type Ring = Pair[];
type MultiPoly = Ring[][];

/** A polygon with optional inner rings (holes). */
export interface PolyWithHoles {
  points: number[][];
  holes: number[][][];
}

function toRing(pts: number[][]): Ring {
  return pts.map(p => [p[0], p[1]] as Pair);
}

function fromRing(ring: Ring): number[][] {
  return ring.map(p => [p[0], p[1]]);
}

function toClipping(p: PolyWithHoles): Ring[] {
  return [toRing(p.points), ...p.holes.map(toRing)];
}

/** Convert a polygon-clipping multi-polygon result into polygons-with-holes. */
function fromClipping(result: MultiPoly): PolyWithHoles[] {
  return result
    .filter(poly => poly && poly.length > 0)
    .map(poly => ({
      points: fromRing(poly[0]),
      holes: poly.slice(1).map(fromRing).filter(h => h.length >= 3),
    }))
    .filter(p => p.points.length >= 3);
}

/**
 * Union two polygons (with holes).
 * Returns ALL resulting polygons (multi-polygon), or empty array.
 */
export function unionPolygons(a: PolyWithHoles, b: PolyWithHoles): PolyWithHoles[] {
  const result = polygonClipping.union(toClipping(a), toClipping(b));
  return fromClipping(result as MultiPoly);
}

/**
 * Union multiple polygons together (for merging shapes of same label).
 * Returns ALL resulting polygons, or empty array.
 */
export function unionMany(polys: PolyWithHoles[]): PolyWithHoles[] {
  if (polys.length === 0) return [];
  let result: MultiPoly = [toClipping(polys[0])];
  for (let i = 1; i < polys.length; i++) {
    result = polygonClipping.union(result, toClipping(polys[i])) as MultiPoly;
  }
  return fromClipping(result);
}

/**
 * Subtract polygon b from polygon a (a - b).
 * Returns ALL resulting polygons (multi-polygon), or empty array.
 */
export function subtractPolygons(a: PolyWithHoles, b: PolyWithHoles): PolyWithHoles[] {
  const result = polygonClipping.difference(toClipping(a), toClipping(b));
  return fromClipping(result as MultiPoly);
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

/** Area of a polygon-with-holes (outer area minus hole areas). */
export function shapeArea(p: PolyWithHoles): number {
  let a = polygonArea(p.points);
  for (const h of p.holes) a -= polygonArea(h);
  return a;
}

/**
 * True if two polygons (with holes) overlap (their intersection has non-zero area).
 */
export function polygonsOverlap(a: PolyWithHoles, b: PolyWithHoles): boolean {
  const result = polygonClipping.intersection(toClipping(a), toClipping(b));
  const pieces = fromClipping(result as MultiPoly);
  return pieces.some(p => shapeArea(p) > 1e-6);
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
 * True if point is inside a polygon-with-holes: inside the outer ring
 * and not inside any hole ring.
 */
export function isPointInShape(px: number, py: number, points: number[][], holes: number[][][]): boolean {
  if (!isPointInPolygon(px, py, points)) return false;
  return !holes.some(h => isPointInPolygon(px, py, h));
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
