import type { MemoryTier, MemoryCategory } from '../api';

interface TierBadgeProps {
  tier: MemoryTier;
}

export function TierBadge({ tier }: TierBadgeProps) {
  return (
    <span className={`badge badge-tier-${tier}`}>
      {tier}
    </span>
  );
}

interface CategoryBadgeProps {
  category: MemoryCategory;
}

const SPECIAL_CATS = new Set(['infrastructure', 'credentials', 'shared_config']);

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const cls = SPECIAL_CATS.has(category)
    ? `badge badge-cat-${category}`
    : 'badge badge-cat-default';
  return <span className={cls}>{category.replace(/_/g, ' ')}</span>;
}

interface ImportanceBarProps {
  value: number; // 0–1
}

export function ImportanceBar({ value }: ImportanceBarProps) {
  const pct = Math.round(value * 100);
  return (
    <div className="importance-bar">
      <div className="importance-track">
        <div className="importance-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="importance-label">{pct}%</span>
    </div>
  );
}
