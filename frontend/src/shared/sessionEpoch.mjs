export function createSessionEpoch() {
  let current = 0;
  return {
    capture() {
      return current;
    },
    invalidate() {
      current += 1;
      return current;
    },
    isCurrent(captured) {
      return captured === current;
    },
  };
}

/**
 * Commit a rotated credential only while it still belongs to the browser
 * session that started the refresh. A logout or a newer login invalidates the
 * captured epoch; the newly rotated server credential must then be revoked
 * instead of resurrecting local storage.
 */
export async function finalizeRotatedCredential(epoch, captured, credential, commit, revoke) {
  if (epoch.isCurrent(captured)) {
    commit(credential);
    return credential.accessToken;
  }
  await revoke(credential);
  throw new Error("session changed while access token was refreshing");
}
