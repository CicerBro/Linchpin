import { ProviderError } from './types';

type ProviderErrorPayload = {
  error?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

function errorDetails(payload: unknown): { code: string; type: string; message: string } {
  const error =
    payload && typeof payload === 'object' ? (payload as ProviderErrorPayload).error : undefined;
  return {
    code: typeof error?.code === 'string' ? error.code.toLowerCase() : '',
    type: typeof error?.type === 'string' ? error.type.toLowerCase() : '',
    message: typeof error?.message === 'string' ? error.message.toLowerCase() : '',
  };
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function providerHttpError(
  response: Response,
  providerName: string,
  context = 'request',
): Promise<ProviderError> {
  const { status } = response;
  const details = errorDetails(await readErrorPayload(response));
  if (status === 401 || status === 403) {
    return new ProviderError(`${providerName} rejected the API key.`, 'auth', status);
  }

  const insufficientQuota =
    details.code === 'insufficient_quota' ||
    details.type === 'insufficient_quota' ||
    /\b(quota|billing|credit balance|credits)\b/.test(details.message);
  if (status === 402 || insufficientQuota) {
    return new ProviderError(
      `${providerName} has no available API quota. Check the provider's billing and credit balance.`,
      'quota',
      status,
    );
  }
  if (status === 429) {
    return new ProviderError(
      `${providerName} rate limit was reached. Try again later.`,
      'rate-limit',
      status,
    );
  }
  return new ProviderError(
    `${providerName} ${context} failed (HTTP ${status}).`,
    'response',
    status,
  );
}
