/**
 * Return the already-rotated access token when a late 401 belongs to the
 * previous access-token generation. The caller retries once with this token
 * instead of rotating the refresh credential a second time.
 */
export function newerAccessTokenForRetry(failedAuthorization, currentAccessToken) {
  const prefix = "Bearer ";
  if (!failedAuthorization.startsWith(prefix) || !currentAccessToken) return null;
  const failedAccessToken = failedAuthorization.slice(prefix.length);
  if (!failedAccessToken || failedAccessToken === currentAccessToken) return null;
  return currentAccessToken;
}

/** A browser session is recoverable only when both rotating credentials exist. */
export function hasCoherentCredential(accessToken, refreshToken) {
  return typeof accessToken === "string" && accessToken.length > 0 &&
    typeof refreshToken === "string" && refreshToken.length > 0;
}

function failedAccessTokenFromAuthorization(failedAuthorization) {
  const prefix = "Bearer ";
  if (!failedAuthorization.startsWith(prefix)) return null;
  return failedAuthorization.slice(prefix.length) || null;
}

/**
 * Coordinate access-token recovery by failed token generation.
 *
 * The active promise covers concurrent 401 responses. The completed entry is
 * equally important: a late response can reach the interceptor after the
 * winner settled but before its caller observes storage. Remembering the last
 * failed generation prevents that response from rotating the refresh token a
 * second time. A 401 for the replacement generation still starts a new
 * recovery, which is required after an explicit signing-key rotation.
 */
export function createAccessTokenRecovery(readCurrentAccessToken, rotateAccessToken) {
  let inFlight = null;
  let completed = null;

  async function recover(failedAuthorization) {
    const failedAccessToken = failedAccessTokenFromAuthorization(failedAuthorization);
    const currentAccessToken = readCurrentAccessToken();
    const alreadyRotated = newerAccessTokenForRetry(
      failedAuthorization,
      currentAccessToken,
    );
    if (alreadyRotated) return alreadyRotated;
    if (
      failedAccessToken &&
      completed?.failedAccessToken === failedAccessToken
    ) {
      return completed.replacementAccessToken;
    }

    if (inFlight) {
      const winner = inFlight;
      const replacementAccessToken = await winner.promise;
      if (
        !failedAccessToken ||
        !winner.failedAccessToken ||
        winner.failedAccessToken === failedAccessToken
      ) {
        return replacementAccessToken;
      }
      const latestAccessToken = readCurrentAccessToken();
      if (latestAccessToken && latestAccessToken !== failedAccessToken) {
        return latestAccessToken;
      }
      return recover(failedAuthorization);
    }

    const operation = {
      failedAccessToken,
      promise: Promise.resolve().then(rotateAccessToken),
      done: null,
    };
    operation.done = operation.promise.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (inFlight === operation) inFlight = null;
    });
    inFlight = operation;
    const replacementAccessToken = await operation.promise;
    if (failedAccessToken) {
      completed = { failedAccessToken, replacementAccessToken };
    }
    return replacementAccessToken;
  }

  return {
    recover,
    reset() {
      completed = null;
    },
    async waitForIdle() {
      while (inFlight) {
        await inFlight.done;
      }
    },
  };
}
