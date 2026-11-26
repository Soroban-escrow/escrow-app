'use client';

import { useCallback, useEffect, useState } from 'react';

interface HealthReport {
  ok: boolean;
  db: boolean;
  rpc: boolean;
  redis: boolean;
  indexerLagLedgers: number | null;
}

export default function StatusPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkHealth = useCallback(async () => {
    setRefreshing(true);
    try {
      let res = await fetch('/api/health');
      if (res.status === 404) {
        res = await fetch('/health');
      }
      // /health returns 200 on ok, or 503 on dependency failure; both return JSON
      const data = (await res.json().catch(() => null)) as HealthReport | null;
      if (data && typeof data === 'object') {
        setReport(data);
        setReachable(true);
      } else {
        setReport(null);
        setReachable(res.ok);
      }
      setLastUpdated(new Date());
    } catch {
      setReport(null);
      setReachable(false);
      setLastUpdated(new Date());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const interval = setInterval(() => {
      void checkHealth();
    }, 30_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const indexerLagText = () => {
    if (reachable === false) return 'Unavailable';
    if (!report || report.indexerLagLedgers === null || report.indexerLagLedgers === undefined) {
      return reachable ? 'N/A' : 'Checking…';
    }
    if (report.indexerLagLedgers === 0) return '0 ledgers (up to date)';
    return `${report.indexerLagLedgers} ${report.indexerLagLedgers === 1 ? 'ledger' : 'ledgers'}`;
  };

  const statusHeadline = () => {
    if (reachable === null) return 'Checking service status…';
    if (!reachable) return 'API is unreachable';
    if (report?.ok) return 'All systems operational';
    return 'Service degraded';
  };

  return (
    <>
      <p className="eyebrow" style={{ marginTop: '2.5rem' }}>System Status</p>
      <h1>Service Status</h1>
      <p className="lede">
        Live health metrics for the SkillEscrow API, dependencies, and ledger indexer.
      </p>

      <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <span
              className={`status ${reachable === true && report?.ok ? 'open' : reachable === false ? 'refunded' : 'disputed'}`}
              style={{ fontSize: '0.88rem' }}
            >
              {statusHeadline()}
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void checkHealth()}
              disabled={refreshing}
              className="ghost"
              style={{ height: '2.1rem', padding: '0 0.9rem', fontSize: '0.8rem' }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </div>
      </div>

      <div className="facts" style={{ marginTop: '1.5rem' }}>
        <div>
          <dt>API Reachability</dt>
          <dd>
            {reachable === null ? (
              <span className="muted">Checking…</span>
            ) : reachable ? (
              <span className="ok" style={{ fontWeight: 600 }}>Reachable</span>
            ) : (
              <span className="error" style={{ fontWeight: 600 }}>Unreachable</span>
            )}
          </dd>
        </div>

        <div>
          <dt>Indexer Lag</dt>
          <dd className="mono">
            {indexerLagText()}
          </dd>
        </div>

        <div>
          <dt>Last Updated</dt>
          <dd className="mono" style={{ fontSize: '0.88rem' }}>
            {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Checking…'}
          </dd>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Components</h2>
        <div className="flow">
          <div className="perm">
            <span>Database</span>
            <span>
              {reachable === false
                ? 'Unavailable'
                : report
                ? report.db ? 'Operational' : 'Failing'
                : 'Checking…'}
            </span>
          </div>
          <div className="perm">
            <span>Stellar RPC</span>
            <span>
              {reachable === false
                ? 'Unavailable'
                : report
                ? report.rpc ? 'Operational' : 'Failing'
                : 'Checking…'}
            </span>
          </div>
          <div className="perm">
            <span>Redis Cache &amp; Queue</span>
            <span>
              {reachable === false
                ? 'Unavailable'
                : report
                ? report.redis ? 'Operational' : 'Failing'
                : 'Checking…'}
            </span>
          </div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: '1.5rem' }}>
        This page automatically refreshes every 30 seconds.
      </p>
    </>
  );
}
