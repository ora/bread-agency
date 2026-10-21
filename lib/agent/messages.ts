/**
 * Everything the agent writes. Built only from our own menu and order data:
 * nothing a customer sent is quoted back, so a message cannot make the agent
 * say something it should not.
 */

import { BUSINESS, formatPrice, menuItem, menuLines } from "@/lib/menu";
import type { OrderLine } from "./parse";
import { describeLocal } from "./time";

export const DEMO_NOTE = "This is a demo pizzeria run by Ora for NANDA: no food is made and nothing is charged.";

const HOW_TO_ORDER =
  'To order, send a schedule request naming the pizzas and a pickup time, for example "2 margheritas for pickup tomorrow at 7pm", ' +
  'or put {"items": [{"id": "margherita", "qty": 2}], "pickupAt": "<RFC 3339 time>"} in constraints.';

export function lineSummary(lines: OrderLine[]): string {
  return lines
    .map((line) => {
      const item = menuItem(line.id);
      return item ? `${line.qty} x ${item.name}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

export function infoText(): string {
  return [
    `${BUSINESS.name}: sourdough pizza for pickup in ${BUSINESS.city}, every day from 5 to 9 PM.`,
    `Menu: ${menuLines().join(" | ")}`,
    HOW_TO_ORDER,
    DEMO_NOTE,
  ].join("\n");
}

export function needItemsText(): string {
  return [`Happy to take your order. Which pizzas would you like?`, `Menu: ${menuLines().join(" | ")}`, HOW_TO_ORDER].join("\n");
}

export function proposalText(args: {
  lines: OrderLine[];
  totalCents: number;
  pickup: Date;
  orderId: string;
  adjusted: boolean;
}): string {
  return [
    `${BUSINESS.name} can have ${lineSummary(args.lines)} ready for pickup on ${describeLocal(args.pickup, BUSINESS.timeZone)}.`,
    args.adjusted ? "That is the nearest open pickup slot to the time you asked for." : null,
    `Total ${formatPrice(args.totalCents)}, paid at pickup. Order ${args.orderId}.`,
    "Accept this proposal to place the order, then confirm.",
    DEMO_NOTE,
  ]
    .filter(Boolean)
    .join("\n");
}

export function noSlotText(): string {
  return `Sorry, every pickup slot in the next ${BUSINESS.orderWindowDays} days is full for an order that size. ${DEMO_NOTE}`;
}
