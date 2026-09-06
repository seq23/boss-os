/**
 * Broker boundary.
 *
 * Every execution path in the trading lane goes through a BrokerAdapter. The
 * paper adapter is fully implemented and moves no money. There is deliberately
 * no live adapter in this build: shipping one would put real-money execution a
 * config flag away, and the canonical plan requires the micro-live gates to be
 * satisfied and reviewed before that code exists.
 */

export interface BrokerOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  orderType: string;
  limitPrice: number | null;
  refPrice: number | null;
}

export interface BrokerFill {
  price: number;
  qty: number;
  feeMicros: number;
  brokerRef: string;
  simulated: boolean;
}

export interface BrokerAdapter {
  id: string;
  mode: "paper" | "live";
  /** Throws with an actionable message when the order cannot be filled. */
  submit(order: BrokerOrder): Promise<BrokerFill>;
}

export class BrokerUnavailable extends Error {
  constructor(message: string, public hint: string) {
    super(message);
  }
}

/**
 * Paper adapter. Fills the whole quantity at the price the caller supplied,
 * because a simulator that guesses a price is a simulator that lies. Limit
 * orders fill at the limit; market orders fill at the reference price the
 * operator recorded when drafting the order.
 */
export const paperBroker: BrokerAdapter = {
  id: "paper",
  mode: "paper",
  async submit(order) {
    const price = order.orderType === "limit" ? order.limitPrice : (order.refPrice ?? order.limitPrice);
    if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) {
      throw new BrokerUnavailable(
        "This paper order has no price to fill against",
        "Boss OS has no market data feed. Redraft the order with a reference price you observed.",
      );
    }
    return {
      price,
      qty: order.qty,
      feeMicros: 0,
      brokerRef: `paper:${order.id}`,
      simulated: true,
    };
  },
};

const ADAPTERS: Record<string, BrokerAdapter> = {
  paper: paperBroker,
};

export function getBroker(mode: string): BrokerAdapter {
  const adapter = ADAPTERS[mode];
  if (!adapter) {
    throw new BrokerUnavailable(
      `No broker adapter is installed for ${mode} mode`,
      "Only paper execution exists in this build. A live adapter is a separate, gated change.",
    );
  }
  return adapter;
}
