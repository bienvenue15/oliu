/**
 * Outgoing e-mail. In development and tests nothing leaves the machine: every message is kept in
 * memory and readable at GET /dev/mail. In production an SMTP URL is used.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

const outbox: Mail[] = [];
const MAX_KEPT = 200;

const transport =
  config.MAIL_TRANSPORT === 'smtp' && config.SMTP_URL
    ? nodemailer.createTransport(config.SMTP_URL)
    : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const mail: Mail = { to, subject, text, sentAt: new Date() };
  if (transport) {
    await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
    return;
  }
  outbox.unshift(mail);
  if (outbox.length > MAX_KEPT) outbox.length = MAX_KEPT;
}

/** Development only: the kept messages, newest first. */
export function devOutbox(): readonly Mail[] {
  return outbox;
}

/** Tests only. */
export function clearOutbox() {
  outbox.length = 0;
}
