import { useState } from 'react';
import { DEFAULT_PALETTE } from '../../utils/color-palette';
import styles from './ColorPicker.module.css';

interface Props {
  value: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.swatch}
        style={{ backgroundColor: value }}
        onClick={() => setOpen(!open)}
        type="button"
      />
      {open && (
        <div className={styles.popover}>
          <div className={styles.grid}>
            {DEFAULT_PALETTE.map(c => (
              <button
                key={c}
                className={`${styles.cell} ${c === value ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => { onChange(c); setOpen(false); }}
                type="button"
              />
            ))}
          </div>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={styles.input}
          />
        </div>
      )}
    </div>
  );
}
