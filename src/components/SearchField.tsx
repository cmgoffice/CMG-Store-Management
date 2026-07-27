import { Search } from 'lucide-react';
import styles from './SearchField.module.css';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchField({ value, onChange, placeholder }: SearchFieldProps) {
  return (
    <label className={styles.search}>
      <Search aria-hidden="true" size={18} />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? 'ค้นหา'}
      />
    </label>
  );
}
