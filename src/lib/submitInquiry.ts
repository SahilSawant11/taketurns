/**
 * The single place inquiries are sent from.
 *
 * Setup: set PUBLIC_INQUIRY_ENDPOINT in `.env` to any endpoint that accepts a
 * JSON POST, e.g. a Formspree form URL (https://formspree.io/f/xxxx), a
 * Web3Forms/Basin endpoint, or your own serverless function. Until it is set,
 * the form reports "not configured" instead of pretending to send.
 */
export type Inquiry = Record<string, string>;
export type InquiryResult =
  | { status: 'sent' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string };

const endpoint = import.meta.env.PUBLIC_INQUIRY_ENDPOINT as string | undefined;

export async function submitInquiry(data: Inquiry): Promise<InquiryResult> {
  if (!endpoint) return { status: 'not-configured' };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) return { status: 'error', message: `The server responded with ${res.status}.` };
    return { status: 'sent' };
  } catch {
    return { status: 'error', message: 'We couldn’t reach the server. Check your connection and try again.' };
  }
}
