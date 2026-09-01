export function newerAccessTokenForRetry(
  failedAuthorization: string,
  currentAccessToken: string | null,
): string | null;

export function hasCoherentCredential(
  accessToken: string | null | undefined,
  refreshToken: string | null | undefined,
): boolean;

export type AccessTokenRecovery = {
  recover(failedAuthorization: string): Promise<string>;
  reset(): void;
  waitForIdle(): Promise<void>;
};

export function createAccessTokenRecovery(
  readCurrentAccessToken: () => string | null,
  rotateAccessToken: () => Promise<string>,
): AccessTokenRecovery;
