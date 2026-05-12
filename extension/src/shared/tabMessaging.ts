export interface TabMessagingDeps {
  sendTabMessage<T>(tabId: number, message: unknown): Promise<T>;
  waitForTabReady(tabId: number, signal: AbortSignal): Promise<void>;
  executeScriptFile(tabId: number, file: string): Promise<void>;
  ensureNotAborted(): void;
}

export async function sendMessageWithInjection<T>(
  tabId: number,
  message: unknown,
  file: string,
  signal: AbortSignal,
  deps: TabMessagingDeps
): Promise<T> {
  deps.ensureNotAborted();
  try {
    return await deps.sendTabMessage<T>(tabId, message);
  } catch (error) {
    deps.ensureNotAborted();

    if (isChannelClosed(error)) {
      await deps.waitForTabReady(tabId, signal);
      deps.ensureNotAborted();
      await deps.executeScriptFile(tabId, file);
      deps.ensureNotAborted();
      return deps.sendTabMessage<T>(tabId, message);
    }

    if (!isMissingReceiver(error)) {
      throw error;
    }

    await deps.executeScriptFile(tabId, file);
    deps.ensureNotAborted();
    return deps.sendTabMessage<T>(tabId, message);
  }
}

function isMissingReceiver(error: unknown): boolean {
  return (
    error instanceof Error &&
    /receiving end does not exist|could not establish connection/i.test(
      error.message
    )
  );
}

function isChannelClosed(error: unknown): boolean {
  return (
    error instanceof Error &&
    /message channel closed/i.test(error.message)
  );
}
