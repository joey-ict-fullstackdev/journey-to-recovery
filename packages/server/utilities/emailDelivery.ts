type SendResult = { error?: unknown };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Sends a shared payload separately to each recipient. All sends are attempted
 * before an aggregate, recipient-safe error is reported to the caller.
 */
export async function sendIndividually<T extends SendResult>(
  recipients: readonly string[],
  send: (recipient: string) => Promise<T>,
): Promise<void> {
  const results = await Promise.allSettled(recipients.map((recipient) => send(recipient)));
  const failures = results.flatMap((result) => {
    if (result.status === "rejected") return [errorMessage(result.reason)];
    return result.value.error ? [errorMessage(result.value.error)] : [];
  });

  if (failures.length > 0) {
    throw new Error(`Email delivery failed for ${failures.length} recipient(s): ${failures.join("; ")}`);
  }
}
