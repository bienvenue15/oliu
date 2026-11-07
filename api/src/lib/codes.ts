/**
 * One-time codes for a purpose other than login: a payment approval above the threshold, the second pair of eyes on
 * a beneficiary's account. The code goes to the person's own mailbox (the department mailbox they signed up with),
 * is for that purpose only, works once, expires with OTP_MINUTES, and five wrong tries burn it.
 */
import { config } from '../config.ts';
import { prisma, type Tx } from '../db.ts';
import { newOtpCode, sha256 } from './crypto.ts';
import { forbidden } from './errors.ts';
import { sendMail } from './mail.ts';

export async function issueCode(
  userId: string,
  purpose: string,
  mail: { subject: string; text: (code: string) => string },
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { otpMailbox: true },
  });
  const code = newOtpCode();
  await prisma.otpChallenge.create({
    data: {
      userId,
      codeHash: sha256(code),
      purpose,
      expiresAt: new Date(Date.now() + config.OTP_MINUTES * 60_000),
    },
  });
  await sendMail(user.otpMailbox, mail.subject, mail.text(code));
}

/** Spend the person's open code for this purpose, or throw. Inside the caller's transaction. */
export async function consumeCode(tx: Tx, userId: string, purpose: string, code: string) {
  const open = await tx.otpChallenge.findMany({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, codeHash: true },
  });
  const hit = open.find((c) => c.codeHash === sha256(code));
  if (!hit) {
    if (open[0])
      await tx.otpChallenge.update({
        where: { id: open[0].id },
        data: { attempts: { increment: 1 } },
      });
    throw forbidden('That is not your code, or it expired');
  }
  await tx.otpChallenge.update({ where: { id: hit.id }, data: { usedAt: new Date() } });
}
