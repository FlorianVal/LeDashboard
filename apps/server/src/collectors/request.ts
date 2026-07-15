export class RequestTimeoutError extends Error {
  constructor() {
    super("request_timeout");
    this.name = "RequestTimeoutError";
  }
}

export class RequestTransportError extends Error {
  constructor() {
    super("request_failed");
    this.name = "RequestTransportError";
  }
}

export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new RequestTimeoutError()),
      { once: true },
    );
  });
  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAndConsumeWithTimeout<T>(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  return withRequestTimeout(async (signal) => {
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, signal });
    } catch {
      throw new RequestTransportError();
    }
    return consume(response);
  }, timeoutMs);
}
