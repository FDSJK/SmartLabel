import { Path } from 'react-konva';
import { useDraftStore } from '../../stores/draftStore';
import { useUIStore } from '../../stores/uiStore';

function toSvgPath(points: number[][], holes: number[][][]): string {
  const ring = (r: number[][]) => r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('') + 'Z';
  return ring(points) + holes.map(ring).join('');
}

export default function DraftLayer() {
  const draftShapes = useDraftStore((s) => s.draftShapes);
  const showDraft = useUIStore((s) => s.showDraft);

  if (!showDraft) return null;

  return (
    <>
      {draftShapes.map((shape) => (
        <Path
          key={shape.id}
          data={toSvgPath(shape.points, shape.holes ?? [])}
          fillRule="evenodd"
          fill="#2196f3"
          fillOpacity={0.25}
          stroke="#2196f3"
          strokeWidth={2}
          lineJoin="round"
          listening={false}
        />
      ))}
    </>
  );
}
