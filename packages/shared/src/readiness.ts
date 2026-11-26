export interface WalletBalance {
  assetType: string;
  code?: string;
  issuer?: string;
  balance: string;
}

export interface WalletReadiness {
  funded: boolean;
  hasXlm: boolean;
  hasUsdcTrustline: boolean;
  xlmBalance: string;
  usdcBalance?: string;
  ready: boolean;
  warnings: string[];
}

/**
 * Checks whether a Horizon account response indicates the wallet is ready to receive
 * XLM and USDC escrow payouts.
 */
export function checkWalletBalances(balances?: WalletBalance[], tokenSymbol: 'USDC' | 'XLM' | 'ALL' = 'ALL'): WalletReadiness {
  if (!balances || balances.length === 0) {
    return {
      funded: false,
      hasXlm: false,
      hasUsdcTrustline: false,
      xlmBalance: '0',
      ready: false,
      warnings: ['Account is not funded on the Stellar network yet. Fund it with XLM first.'],
    };
  }

  const native = balances.find((b) => b.assetType === 'native' || (b as { asset_type?: string }).asset_type === 'native');
  const xlmAmount = native?.balance ?? (native as unknown as { balance?: string })?.balance ?? '0';
  const hasXlm = Number(xlmAmount) > 0;

  const usdc = balances.find((b) => {
    const code = b.code ?? (b as unknown as { asset_code?: string }).asset_code;
    return code === 'USDC';
  });
  const hasUsdcTrustline = !!usdc;
  const usdcBalance = usdc?.balance ?? (usdc as unknown as { balance?: string })?.balance;

  const warnings: string[] = [];
  if (!hasXlm) {
    warnings.push('Account has 0 XLM balance.');
  }

  if (tokenSymbol === 'USDC' || tokenSymbol === 'ALL') {
    if (!hasUsdcTrustline) {
      warnings.push('No USDC trustline established. Add USDC trustline in your wallet to receive USDC payouts.');
    }
  }

  const ready = tokenSymbol === 'XLM' ? hasXlm : tokenSymbol === 'USDC' ? hasXlm && hasUsdcTrustline : hasXlm && hasUsdcTrustline;

  return {
    funded: true,
    hasXlm,
    hasUsdcTrustline,
    xlmBalance: xlmAmount,
    usdcBalance,
    ready,
    warnings,
  };
}
