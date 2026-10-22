import { BUSINESS, menuLines } from "@/lib/menu";
import { agentLocator } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  const locator = agentLocator();
  const body = [
    `# ${BUSINESS.name}`,
    "",
    `> Sourdough pizza for pickup in ${BUSINESS.city}, every day from 5 to 9 PM. Order a pizza for pickup tomorrow through our ordering agent. A demo business run by Ora for NANDA: no food is made and nothing is charged.`,
    "",
    "## Order through an agent",
    "",
    locator
      ? `- Ordering agent: ${locator} (NANDA Agent Box). Send a schedule request such as "2 margheritas for pickup tomorrow at 7pm"; it answers with a proposal (items, total, pickup slot). Accept the proposal (\`constraints.proposalId\`: the proposal's id), then confirm (\`constraints.acceptanceId\`: your accept message's id).`
      : "- Ordering agent: being set up.",
    `- [AI catalog](https://${BUSINESS.domain}/.well-known/ai-catalog.json): the agent's catalog entry.`,
    "",
    "## Menu",
    "",
    ...menuLines().map((line) => `- ${line}`),
    "",
    "## About",
    "",
    "- [Ora](https://ora.ai): runs this demo and ranks how ready businesses are for AI agents.",
    "- [NANDA Index](https://nandaindex.org): where agents find each other.",
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
