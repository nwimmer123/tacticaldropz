// Send a one-off HTML email to every user in the Users table via SES.
//
// Usage:
//   node send-bulk-email.mjs <content-file> [options]
//
// Content file format:
//   Line 1: subject
//   Line 2: (blank)
//   Remaining lines: HTML body
//
// Options:
//   --send            Actually send emails. Without this flag the script
//                      only prints what it WOULD do (dry run).
//   --test=<email>    Send only to this address, ignoring the users table.
//                      Useful for previewing before a real send.
//   --delay=<ms>      Delay between sends (default 1100ms, SES default
//                      sending rate is 1/sec for new accounts).
//   --resume          Skip addresses already recorded in the per-content
//                      sent-log (<content-file>.sent.json), so an
//                      interrupted run can be safely re-run.
//   --reply-to=<email> Set a Reply-To address so replies go somewhere
//                      other than the From address (which must stay a
//                      verified SES identity).
//
// Examples:
//   node send-bulk-email.mjs update-2026-06.html --test=me@example.com
//   node send-bulk-email.mjs update-2026-06.html --send --resume

import fs from 'fs';
import path from 'path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION      = process.env.AWS_REGION || 'us-west-2';
const USERS_TABLE = process.env.USERS_TABLE || 'tacticaldropz-users';
const FROM_EMAIL  = process.env.SES_FROM_EMAIL || 'Noah <noah@tacticaldropz.com>';

const ses    = new SESClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function parseArgs(argv) {
  const [contentFile, ...rest] = argv;
  const opts = { send: false, resume: false, delay: 1100, test: null, replyTo: null };
  for (const arg of rest) {
    if (arg === '--send') opts.send = true;
    else if (arg === '--resume') opts.resume = true;
    else if (arg.startsWith('--delay=')) opts.delay = Number(arg.slice('--delay='.length));
    else if (arg.startsWith('--test=')) opts.test = arg.slice('--test='.length);
    else if (arg.startsWith('--reply-to=')) opts.replyTo = arg.slice('--reply-to='.length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!contentFile) {
    throw new Error('Usage: node send-bulk-email.mjs <content-file> [--send] [--test=<email>] [--delay=<ms>] [--resume]');
  }
  return { contentFile, ...opts };
}

function loadContent(contentFile) {
  const raw = fs.readFileSync(contentFile, 'utf8');
  const lines = raw.split(/\r?\n/);
  const subject = lines[0].trim();
  // skip the blank separator line, body is everything after it
  const body = lines.slice(2).join('\n').trim();
  if (!subject || !body) {
    throw new Error('Content file must have a subject on line 1, a blank line, then the HTML body.');
  }
  return { subject, html: body };
}

async function getAllUserEmails() {
  const emails = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo.send(new ScanCommand({
      TableName: USERS_TABLE,
      ProjectionExpression: 'email',
      ExclusiveStartKey,
    }));
    for (const item of result.Items || []) {
      if (item.email) emails.push(item.email);
    }
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return emails;
}

function loadSentLog(logFile) {
  if (!fs.existsSync(logFile)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(logFile, 'utf8')));
}

function appendSentLog(logFile, sent) {
  fs.writeFileSync(logFile, JSON.stringify([...sent], null, 2));
}

async function sendOne(toEmail, subject, html, replyTo) {
  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [toEmail] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { subject, html } = loadContent(opts.contentFile);

  console.log(`Subject: ${subject}`);
  console.log(`Mode: ${opts.send ? 'SEND' : 'DRY RUN (pass --send to actually send)'}`);

  let recipients;
  if (opts.test) {
    recipients = [opts.test];
    console.log(`Test mode: sending only to ${opts.test}`);
  } else {
    recipients = await getAllUserEmails();
    console.log(`Found ${recipients.length} user(s) in ${USERS_TABLE}`);
  }

  const logFile = path.resolve(`${opts.contentFile}.sent.json`);
  const alreadySent = opts.resume ? loadSentLog(logFile) : new Set();
  if (opts.resume && alreadySent.size > 0) {
    console.log(`Resuming: ${alreadySent.size} address(es) already sent, will be skipped.`);
  }

  let sentCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const failed = [];

  for (const email of recipients) {
    if (alreadySent.has(email)) {
      skipCount++;
      continue;
    }

    if (!opts.send) {
      console.log(`[dry run] would send to ${email}`);
      continue;
    }

    try {
      await sendOne(email, subject, html, opts.replyTo);
      alreadySent.add(email);
      appendSentLog(logFile, alreadySent);
      sentCount++;
      console.log(`sent -> ${email} (${sentCount}/${recipients.length - skipCount})`);
    } catch (err) {
      errorCount++;
      failed.push({ email, error: err.message });
      console.error(`FAILED -> ${email}: ${err.message}`);
    }

    await sleep(opts.delay);
  }

  if (failed.length > 0) {
    const failedFile = path.resolve(`${opts.contentFile}.failed.json`);
    fs.writeFileSync(failedFile, JSON.stringify(failed, null, 2));
    console.log(`Failed addresses written to: ${failedFile}`);
  }

  console.log('---');
  console.log(`Sent: ${sentCount}, skipped (already sent): ${skipCount}, failed: ${errorCount}`);
  if (opts.send) {
    console.log(`Sent-log written to: ${logFile}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
