import styles from './StatCard.module.css';

interface StatCardProps {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'pink' | 'purple' | 'green' | 'yellow' | 'blue' | 'neutral';
}

export function StatCard({ label, value, detail, tone = 'neutral' }: StatCardProps) {
  return (
    <article className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.sparkline} aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}
