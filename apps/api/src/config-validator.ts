// Strict validation for token contract IDs and explorer templates according to SEP-0023 and Issue #192

export const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEscrowConfig(config: {
  tokenUsdcContractId?: string;
  tokenXlmContractId?: string;
  explorerTxUrlTemplate?: string;
  githubCommandsEnabled?: boolean;
}): ConfigValidationResult {
  const errors: string[] = [];

  if (config.githubCommandsEnabled) {
    if (!config.tokenUsdcContractId || !CONTRACT_ID_REGEX.test(config.tokenUsdcContractId)) {
      errors.push('TOKEN_USDC_CONTRACT_ID must be a valid 56-character StrKey contract ID starting with C');
    }
    if (!config.tokenXlmContractId || !CONTRACT_ID_REGEX.test(config.tokenXlmContractId)) {
      errors.push('TOKEN_XLM_CONTRACT_ID must be a valid 56-character StrKey contract ID starting with C');
    }
  }

  if (config.explorerTxUrlTemplate) {
    if (!config.explorerTxUrlTemplate.startsWith('https://')) {
      errors.push('EXPLORER_TX_URL_TEMPLATE must use https:// protocol');
    }
    if (!config.explorerTxUrlTemplate.includes('{hash}')) {
      errors.push('EXPLORER_TX_URL_TEMPLATE must contain the {hash} placeholder');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
