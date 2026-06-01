import { useState, useEffect } from 'react';
import { memoriesApi, ApiError, type MemoryStat, type MemoryTier } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';

const TIER_ORDER: MemoryTier[] = ['core', 'hot', 'warm', 'cold'];

const TIER_COLORS: Record<MemoryTier, string> = {
  core: 'var(--tier-core)',
  hot: 'var(--tier-hot)',
  warm: 'var(--tier-warm)',
  cold: 'var(--tier-cold)',
};

const TIER_BG: Record<MemoryTier, string> = {
  core: 'rgba(159,122,234,0.15)',
  hot: 'rgba(237,137,54,0.15)',
  warm: 'rgba(66,153,225,0.15)',
  cold: 'rgba(113,128,150,0.15)',
};

export function Stats() {
  const [stats, setStats] = useState<MemoryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await memoriesApi.stats();
        setStats(result.data);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const totalMemories = stats.reduce((sum, s) => sum + Number(s.count), 0);

  // Group by tier for the tier tiles
  const byTier = TIER_ORDER.map(tier => {
    const tierStats = stats.filter(s => s.tier === tier);
    const count = tierStats.reduce((sum, s) => sum + Number(s.count), 0);
    const avgImportance = tierStats.length
      ? tierStats.reduce((sum, s) => sum + s.avg_importance * Number(s.count), 0) / (count || 1)
      : 0;
    return { tier, count, avgImportance };
  });

  // All categories present in stats
  const categories = Array.from(new Set(stats.map(s => s.category))).sort();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Statistics</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Total */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="stats-total">{totalMemories.toLocaleString()}</div>
            <div className="stats-label">Total memories stored</div>
          </div>

          {/* Tier tiles */}
          <div className="stats-grid">
            {byTier.map(({ tier, count, avgImportance }) => (
              <div
                key={tier}
                className="stats-tile"
                style={{
                  borderLeft: `4px solid ${TIER_COLORS[tier]}`,
                  background: TIER_BG[tier],
                }}
              >
                <div className="stats-tile-value" style={{ color: TIER_COLORS[tier] }}>
                  {count.toLocaleString()}
                </div>
                <div style={{ fontWeight: 600, textTransform: 'capitalize', marginBottom: 4 }}>{tier}</div>
                <div className="stats-tile-label">
                  avg importance: {(avgImportance * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>

          {/* Full tier × category table */}
          {stats.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Tier × Category Breakdown</div>
              </div>
              <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      {TIER_ORDER.map(tier => (
                        <th key={tier} style={{ color: TIER_COLORS[tier] }}>
                          {tier}
                        </th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map(category => {
                      const rowTotal = TIER_ORDER.reduce((sum, tier) => {
                        const s = stats.find(x => x.tier === tier && x.category === category);
                        return sum + (s ? Number(s.count) : 0);
                      }, 0);

                      return (
                        <tr key={category}>
                          <td>
                            <span style={{ textTransform: 'capitalize' }}>
                              {category.replace(/_/g, ' ')}
                            </span>
                          </td>
                          {TIER_ORDER.map(tier => {
                            const s = stats.find(x => x.tier === tier && x.category === category);
                            return (
                              <td key={tier} style={{ color: s ? TIER_COLORS[tier] : 'var(--text3)' }}>
                                {s ? (
                                  <span title={`avg importance: ${(s.avg_importance * 100).toFixed(0)}%`}>
                                    {Number(s.count)}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text3)' }}>—</span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ fontWeight: 600 }}>{rowTotal}</td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr style={{ background: 'var(--bg3)', fontWeight: 600 }}>
                      <td>Total</td>
                      {TIER_ORDER.map(tier => {
                        const total = stats
                          .filter(s => s.tier === tier)
                          .reduce((sum, s) => sum + Number(s.count), 0);
                        return (
                          <td key={tier} style={{ color: TIER_COLORS[tier] }}>
                            {total}
                          </td>
                        );
                      })}
                      <td>{totalMemories}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {stats.length === 0 && (
            <div className="empty-state">
              <div style={{ fontSize: 32 }}>📊</div>
              <p>No stats available yet. Create some memories first.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
