export const DEFAULT_PALETTE = [
  '#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#aa44ff',
  '#00cccc', '#ff66aa', '#aacc00', '#886644', '#ff8844',
];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
