import { Dashboard } from "./dashboard";
import { marketSnapshot } from "./data/market-data";

export const dynamic = "force-static";

export default function Home() {
  return <Dashboard snapshot={marketSnapshot} />;
}
