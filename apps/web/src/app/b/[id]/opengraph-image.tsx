import { ImageResponse } from 'next/og';
import { apiGet, money } from '@/lib/api';

export const runtime = 'edge';

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await apiGet<{ issueTitle: string; issueNumber: number; amount: string; token: string; repo: { fullName: string } }>(`/bounties/${encodeURIComponent(id)}`);
  const title = b?.issueTitle || `Bounty #${b?.issueNumber ?? id}`;
  return new ImageResponse(
    <div style={{ background: '#f6f5f1', color: '#121210', width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', fontSize: 28, color: '#676660' }}>skillescrow · paid GitHub issues</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', fontSize: 64, lineHeight: 1.1, fontWeight: 600 }}>{title}</div>
        <div style={{ display: 'flex', fontSize: 32, color: '#676660' }}>{b?.repo.fullName ?? 'SkillEscrow'}</div>
      </div>
      <div style={{ display: 'flex', fontSize: 44, background: '#c9f25d', padding: '12px 22px', width: 'fit-content' }}>{b ? money(b.amount, b.token) : 'Bounty on Stellar'}</div>
    </div>,
  );
}
