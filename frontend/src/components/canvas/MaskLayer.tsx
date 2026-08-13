import { Line } from 'react-konva';
import { useEditorStore } from '../../stores/editorStore';
import { useLabelStore } from '../../stores/labelStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Renders confirmed shapes as filled semi-transparent polygons.
 * Each shape's fill color comes from its label definition.
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
        // Flatten points array for Konva Line: [[x1,y1], [x2,y2], ...] → [x1, y1, x2, y2, ...]
        const flatPoints = shape.points.flat();
        const fillColor = colorMap.get(shape.label) || '#888888';

        return (
          <Line
            key={shape.id}
            points={flatPoints}
            closed
            {...(showFill ? { fill: fillColor, fillOpacity: 0.25 } : {})}
            stroke={fillColor}
            strokeWidth={showFill ? 1.5 : 2.5}
            lineJoin="round"
            hitStrokeWidth={8}
            listening={false}
          />
        );
      })}
    </>
  );
}
