import { ImageResponse } from 'next/og';
import { apiGet, money, daysLeft, type Detail } from '@/lib/api';
import { escapeMarkup, truncateText } from '@/lib/metadata';

export const runtime = 'edge';
export const revalidate = 3600; // Cache generated card at edge for 1 hour
export const alt = 'SkillEscrow Bounty Card';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'OPEN',
  RELEASED: 'PAID',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
  RESOLVED: 'RESOLVED',
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await apiGet<Detail>(`/bounties/${encodeURIComponent(id)}`);

  if (!b) {
    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0e0e0d',
            color: '#f6f5f1',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ fontSize: 32, color: '#e5534b', marginBottom: 12 }}>SkillEscrow</div>
          <div style={{ fontSize: 48, fontWeight: 'bold' }}>Bounty Not Found</div>
          <div style={{ fontSize: 24, color: '#888', marginTop: 12 }}>This bounty does not exist or has expired.</div>
        </div>
      ),
      { ...size }
    );
  }

  const cleanTitle = truncateText(escapeMarkup(b.issueTitle || `Issue #${b.issueNumber}`), 90);
  const amountStr = money(b.amount, b.token);
  const remainingStr = daysLeft(b.deadline);
  const statusLabel = STATUS_LABELS[b.status] ?? b.status;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 80px',
          backgroundColor: '#0e0e0d',
          color: '#f6f5f1',
          fontFamily: 'sans-serif',
          border: '12px solid #1a1a19',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                backgroundColor: '#c9f25d',
                boxShadow: 'inset 0 0 0 2px #0e0e0d',
              }}
            />
            <span style={{ fontSize: 28, letterSpacing: '2px', fontWeight: 'bold', color: '#f6f5f1' }}>
              SKILLESCROW
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                backgroundColor: b.status === 'OPEN' ? '#c9f25d' : '#232322',
                color: b.status === 'OPEN' ? '#172000' : '#8b949e',
                fontSize: 18,
                fontWeight: 'bold',
                letterSpacing: '1px',
              }}
            >
              {statusLabel}
            </span>
            <div
              style={{
                padding: '8px 20px',
                borderRadius: '24px',
                backgroundColor: '#232322',
                fontSize: 22,
                color: '#8b949e',
              }}
            >
              {b.repo.fullName} #{b.issueNumber}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: '40px 0' }}>
          <div style={{ fontSize: 52, fontWeight: 'bold', lineHeight: 1.2, color: '#ffffff' }}>
            {cleanTitle}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderTop: '2px solid #282826',
            paddingTop: '32px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 20, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Locked in Escrow
            </span>
            <span style={{ fontSize: 64, fontWeight: '900', color: '#c9f25d' }}>
              {amountStr}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 18, color: '#8b949e' }}>Time Remaining</span>
              <span style={{ fontSize: 32, fontWeight: 'bold', color: '#f6f5f1' }}>{remainingStr}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 18, color: '#8b949e' }}>Settlement</span>
              <span style={{ fontSize: 32, fontWeight: 'bold', color: '#c9f25d' }}>Stellar Soroban</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
