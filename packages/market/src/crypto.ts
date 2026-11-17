/**
 * Crypto symbols. People type `BTC-USD`, `X:BTCUSD` (Massive's spelling) or, for well-known coins, `BTCUSD`.
 * Everything is normalised to the coin code (`BTC`) and priced in US dollars.
 */

export const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  LTC: "Litecoin",
  AVAX: "Avalanche",
  DOT: "Polkadot",
  LINK: "Chainlink",
  BCH: "Bitcoin Cash",
  XLM: "Stellar",
  MATIC: "Polygon",
  SHIB: "Shiba Inu",
  UNI: "Uniswap",
  ATOM: "Cosmos",
};

/** "BTC-USD", "X:BTCUSD", "btc-usd", "BTCUSD" (known coins only) → "BTC". Anything else → null. */
export function cryptoCoin(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  const dashed = /^([A-Z0-9]{2,10})-USD$/.exec(symbol);
  if (dashed) return dashed[1] as string;
  const massive = /^X:([A-Z0-9]{2,10})USD$/.exec(symbol);
  if (massive) return massive[1] as string;
  const plain = /^([A-Z0-9]{2,10})USD$/.exec(symbol);
  if (plain && CRYPTO_NAMES[plain[1] as string]) return plain[1] as string;
  return null;
}

export function cryptoName(coin: string): string {
  return CRYPTO_NAMES[coin] ?? `${coin}-USD`;
}
