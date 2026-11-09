import styles from './Segmented.module.css';

type Option<Value extends string | number> = { value: Value; label: string };

type SegmentedProps<Value extends string | number> = {
  label: string;
  options: Option<Value>[];
  value: Value;
  onChange: (value: Value) => void;
};

export const Segmented = <Value extends string | number>({ label, options, value, onChange }: SegmentedProps<Value>) => (
  <div className={styles.group} role="radiogroup" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        className={styles.option}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);
