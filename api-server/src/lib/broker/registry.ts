/**
 * Broker Registry — singleton that manages broker adapters
 * Supports asset-class routing (e.g. crypto → Binance, stocks → Alpaca)
 */
import type { BrokerAdapter, BrokerName, AssetClass } from "./types.js";

export class BrokerRegistry {
  private adapters = new Map<BrokerName, BrokerAdapter>();
  private assetRoutes = new Map<AssetClass, BrokerName>();
  private defaultBroker: BrokerName | null = null;

  register(adapter: BrokerAdapter): void {
    this.adapters.set(adapter.name, adapter);
    if (!this.defaultBroker) this.defaultBroker = adapter.name;
  }

  setDefault(name: BrokerName): void {
    if (!this.adapters.has(name)) {
      throw new Error(`Broker "${name}" is not registered`);
    }
    this.defaultBroker = name;
  }

  setAssetRoute(asset: AssetClass, broker: BrokerName): void {
    if (!this.adapters.has(broker)) {
      throw new Error(`Broker "${broker}" is not registered`);
    }
    this.assetRoutes.set(asset, broker);
  }

  getBroker(name: BrokerName): BrokerAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`Broker "${name}" is not registered`);
    return adapter;
  }

  getBrokerForAsset(asset: AssetClass): BrokerAdapter {
    const routed = this.assetRoutes.get(asset);
    if (routed) return this.getBroker(routed);
    if (this.defaultBroker) return this.getBroker(this.defaultBroker);
    throw new Error(`No broker configured for asset class "${asset}"`);
  }

  async connectAll(): Promise<void> {
    const tasks = [...this.adapters.values()].map((a) => a.connect());
    await Promise.all(tasks);
  }

  async disconnectAll(): Promise<void> {
    const tasks = [...this.adapters.values()].map((a) => a.disconnect());
    await Promise.all(tasks);
  }

  getStatus(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [name] of this.adapters) out[name] = true;
    return out;
  }

  get registeredBrokers(): BrokerName[] {
    return [...this.adapters.keys()];
  }
}

export const brokerRegistry = new BrokerRegistry();
