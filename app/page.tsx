import { BUSINESS, MENU, formatPrice } from "@/lib/menu";
import { agentLocator } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const locator = agentLocator();
  return (
    <main>
      <p className="eyebrow">{BUSINESS.city}</p>
      <h1>{BUSINESS.name}</h1>
      <p className="lede">
        Sourdough pizza for pickup, every day from 5 to 9 PM. Order a pizza for pickup tomorrow by asking your AI
        assistant: our ordering agent answers it directly.
      </p>

      <section aria-labelledby="order">
        <h2 id="order">Order through your agent</h2>
        {locator ? (
          <ol>
            <li>
              Ask your assistant to message <code>{locator}</code> on NANDA.
            </li>
            <li>Say what you want and when, for example &ldquo;2 margheritas for pickup tomorrow at 7pm&rdquo;.</li>
            <li>Our agent proposes the order, total and pickup slot. Your assistant checks with you, then accepts and confirms.</li>
          </ol>
        ) : (
          <p>Our ordering agent is being set up.</p>
        )}
      </section>

      <section aria-labelledby="menu">
        <h2 id="menu">Menu</h2>
        <ul className="menu">
          {MENU.map((item) => (
            <li key={item.id}>
              <div>
                <div className="name">{item.name}</div>
                <div className="desc">{item.description}</div>
              </div>
              <div className="price">{formatPrice(item.priceCents)}</div>
            </li>
          ))}
        </ul>
      </section>

      <footer>
        <p>
          A demo business run by <a href="https://ora.ai">Ora</a> for <a href="https://nandaindex.org">NANDA</a>. No
          food is made and nothing is charged. Our agent replies automatically. For agents:{" "}
          <a href="/llms.txt">llms.txt</a>, <a href="/.well-known/ai-catalog.json">AI catalog</a>.
        </p>
      </footer>
    </main>
  );
}
