// Telegram notifications

import axios from 'axios';
import type { Item, PricingResult } from '../types.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function getTelegramClient() {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return axios.create({ baseURL: `https://api.telegram.org/bot${BOT_TOKEN}` });
}

type ButtonRow = Array<{ text: string; callback_data: string }>;

export async function sendMessage(text: string, buttons?: ButtonRow[]): Promise<void> {
  const client = getTelegramClient();
  await client.post('/sendMessage', {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    reply_markup: buttons
      ? { inline_keyboard: buttons }
      : undefined,
  });
}

export async function notifyPendingReview(
  item: Item,
  pricing: PricingResult,
  reviewReason: string,
): Promise<void> {
  const photoLink = item.photoUrls[0] ? `[View Photo](${item.photoUrls[0]})` : 'No photo';

  const text = [
    `🔍 <b>Item Needs Review — ${item.id}</b>`,
    '',
    `<b>Reason:</b> ${reviewReason}`,
    '',
    item.description ? `<b>Description:</b>\n${item.description.substring(0, 300)}` : '',
    '',
    `<b>Brand:</b> ${item.brand ?? 'Unknown'}`,
    `<b>Size:</b> ${item.size ?? 'Unknown'}`,
    `<b>Condition:</b> ${ { nwt: 'New with Tags', nwot: 'New without Tags', like_new: 'Like New', good: 'Good', fair: 'Fair' }[item.condition] ?? item.condition }`,
    `<b>Suggested Price:</b> $${pricing.price}`,
    '',
    `📷 ${photoLink}`,
  ]
    .filter(Boolean)
    .join('\n');

  const approveButton: ButtonRow = [
    { text: `✅ Approve at $${pricing.price}`, callback_data: `approve_${item.id}_${pricing.price}` },
    { text: '⏭️ Skip for now', callback_data: `skip_${item.id}` },
  ];

  await sendMessage(text, [approveButton]);
}

export async function notifyItemPosted(item: Item): Promise<void> {
  const text = [
    `✅ <b>Item Posted — ${item.id}</b>`,
    '',
    item.description ? `${item.description.substring(0, 200)}` : '',
    '',
    `<b>Price:</b> $${item.currentPrice}`,
    `<b>Link:</b> ${item.poshmarkUrl ?? 'N/A'}`,
  ]
    .filter(Boolean)
    .join('\n');

  await sendMessage(text);
}

export async function notifyReadyToPost(
  item: Item,
  pricing: PricingResult,
): Promise<void> {
  const text = [
    `🚀 <b>Ready to Post — ${item.id}</b>`,
    '',
    `<b>Brand:</b> ${item.brand ?? 'Unknown'}`,
    `<b>Size:</b> ${item.size ?? 'Unknown'}`,
    `<b>Condition:</b> ${ { nwt: 'New with Tags', nwot: 'New without Tags', like_new: 'Like New', good: 'Good', fair: 'Fair' }[item.condition] ?? item.condition }`,
    `<b>Price:</b> $${item.currentPrice}`,
    `<b>Confidence:</b> ${pricing.confidence}`,
    '',
    item.description ? `${item.description.substring(0, 200)}` : '',
    '',
    `📷 ${item.photoUrls[0] ? `[View Photo](${item.photoUrls[0]})` : 'No photo'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const approveButton: ButtonRow = [
    { text: `✅ Post Now at $${item.currentPrice}`, callback_data: `post_${item.id}` },
    { text: '⏭️ Skip for now', callback_data: `skip_${item.id}` },
  ];

  await sendMessage(text, [approveButton]);
}

export async function notifyError(itemId: string, error: string): Promise<void> {
  await sendMessage(`❌ <b>Error Posting ${itemId}</b>\n\n${error}`);
}

export async function notifyRunSummary(
  processed: number,
  posted: number,
  pendingReview: number,
  readyToPost: number,
  sold: number,
  errors: number,
): Promise<void> {
  const emoji = errors > 0 ? '⚠️' : '✅';
  const text = [
    `${emoji} <b>Poshmark Run Complete</b>`,
    '',
    `Processed: ${processed}`,
    `Pending Review: ${pendingReview}`,
    `Ready to Post: ${readyToPost}`,
    `Posted: ${posted}`,
    `Sold: ${sold}`,
    `Errors: ${errors}`,
  ].join('\n');

  await sendMessage(text);
}
