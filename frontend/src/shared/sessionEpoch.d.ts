export type SessionEpoch = {
  capture(): number;
  invalidate(): number;
  isCurrent(captured: number): boolean;
};

export type RotatedCredential = {
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
};

export function createSessionEpoch(): SessionEpoch;

export function finalizeRotatedCredential(
  epoch: SessionEpoch,
  captured: number,
  credential: RotatedCredential,
  commit: (credential: RotatedCredential) => void,
  revoke: (credential: RotatedCredential) => Promise<void>,
): Promise<string>;
