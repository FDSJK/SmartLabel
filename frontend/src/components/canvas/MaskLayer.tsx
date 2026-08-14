import { Path } from 'react-konva';
import { useEditorStore } from '../../stores/editorStore';
import { useLabelStore } from '../../stores/labelStore';
import { useUIStore } from '../../stores/uiStore';

/** Build an SVG path string from an outer ring plus inner hole rings. */
function toSvgPath(points: number[][], holes: number[][][]): string {
  const ring = (r: number[][]) =>
    r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('') + 'Z';
  return ring(points) + holes.map(ring).join('');
}

/**
 * Renders confirmed shapes as filled semi-transparent polygons.
 * Each shape's fill color comes from its label definition.
 * Holes are rendered via even-odd fill rule.
 * Visibility is controlled by uiStore.showMask.
 */
export default function MaskLayer() {
  const shapes = useEditorStore(s => s.shapes);
  const showMask = useUIStore(s => s.showMask);
  const showFill = useUIStore(s => s.showFill);
  const labels = useLabelStore(s => s.labels);

  // Build a label-name → color lookup
  const colorMap = new Map<string, string>();
  for (const l of labels) {
    colorMap.set(l.name, l.color);
  }

  if (!showMask) return null;

  return (
    <>
      {shapes.map(shape => {
        const fillColor = colorMap.get(shape.label) || '#888888';

        return (
          <Path
            key={shape.id}
            data={toSvgPath(shape.points, shape.holes ?? [])}
            fillRule="evenodd"
            {...(showFill ? { fill: fillColor, fillOpacity: 0.25 } : {})}
            stroke={fillColor}
            strokeWidth={showFill ? 1.5 : 2.5}
            lineJoin="round"
            listening={false}
          />
        );
      })}
    </>
  );
}
