import { createHmac } from 'node:crypto';
import { decodePages, encodePages, type Page } from '@grimoire/glyphs';
import {
  create,
  ExternalPluginAdapterSchema,
  fetchCollectionV1,
  mplCore,
  safeFetchAssetV1,
  updatePlugin,
  writeData,
  type CollectionV1,
} from '@metaplex-foundation/mpl-core';
import {
  createSignerFromKeypair,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  type KeypairSigner,
  type TransactionBuilder,
  type Umi,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { GrimoireChain, GrimoireState, GrimoireWrite } from './app';
import { grimoireName } from './brand';
import type { Config } from './config';
import type { Attribute } from './grimoire';

/**
 * Grimoires on Solana with Metaplex Core:
 * - one collection "Acrune Grimoires" with PermanentFreezeDelegate (frozen, authority None),
 *   so every grimoire in it is soulbound;
 * - one asset per wallet at a deterministic address (keypair seeded by HMAC of the wallet),
 *   owned by the player, with Attributes and an AppData plugin (Binary) holding the pages.
 * The relayer key pays, is the collection's update authority and the AppData data authority.
 */

const CONFIRM_TIMEOUT_MS = 15_000;

export function relayerUmi(rpcUrl: string, secretKey: Uint8Array | null): Umi {
  const umi = createUmi(rpcUrl, 'confirmed').use(mplCore());
  if (secretKey) umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secretKey)));
  return umi;
}

/** Sends a transaction and waits up to 15 s for confirmation. */
export async function sendTx(umi: Umi, builder: TransactionBuilder): Promise<{ signature: string; confirmed: boolean }> {
  const blockhash = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' });
  const raw = await builder.setBlockhash(blockhash).send(umi, { commitment: 'confirmed' });
  const signature = base58.deserialize(raw)[0];
  const confirmation = umi.rpc.confirmTransaction(raw, { strategy: { type: 'blockhash', ...blockhash }, commitment: 'confirmed' });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CONFIRM_TIMEOUT_MS));
  const result = await Promise.race([confirmation, timeout]);
  if (result === null) return { signature, confirmed: false };
  if (result.value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
  return { signature, confirmed: true };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}


export interface CoreGrimoiresOptions {
  assetSeedSecret: string;
  collection: string;
  publicBaseUrl: string;
}

export class CoreGrimoires implements GrimoireChain {
  private collectionAccount: CollectionV1 | null = null;

  constructor(
    private readonly umi: Umi,
    private readonly options: CoreGrimoiresOptions,
  ) {}

  /** The grimoire's keypair: only the relayer can derive it, so only the relayer can create it. */
  signerFor(wallet: string): KeypairSigner {
    const seed = createHmac('sha256', this.options.assetSeedSecret).update(`grimoire:${wallet}`).digest();
    return createSignerFromKeypair(this.umi, this.umi.eddsa.createKeypairFromSeed(new Uint8Array(seed)));
  }

  assetFor(wallet: string): string {
    return this.signerFor(wallet).publicKey.toString();
  }

  async read(asset: string): Promise<GrimoireState> {
    const account = await safeFetchAssetV1(this.umi, publicKey(asset));
    if (!account) return { asset, exists: false, owner: null, pages: [], attributes: [] };
    const raw = account.appDatas?.[0]?.data as Uint8Array | undefined;
    let pages: Page[] = [];
    if (raw instanceof Uint8Array && raw.length > 0) {
      try {
        pages = decodePages(raw);
      } catch {
        pages = [];
      }
    }
    const attributes = (account.attributes?.attributeList ?? []).map((a) => ({ key: a.key, value: a.value }));
    return { asset, exists: true, owner: account.owner.toString(), pages, attributes };
  }

  private async collection(): Promise<CollectionV1> {
    this.collectionAccount ??= await fetchCollectionV1(this.umi, publicKey(this.options.collection));
    return this.collectionAccount;
  }

  private writePages(asset: KeypairSigner, data: Uint8Array): TransactionBuilder {
    return writeData(this.umi, {
      key: { type: 'AppData', dataAuthority: { type: 'Address', address: this.umi.identity.publicKey } },
      authority: this.umi.identity,
      data,
      asset: asset.publicKey,
      collection: publicKey(this.options.collection),
    });
  }

  async write(wallet: string, pages: Page[], attributes: Attribute[], current: GrimoireState): Promise<GrimoireWrite> {
    const asset = this.signerFor(wallet);
    const address = asset.publicKey.toString();
    const data = encodePages(pages);
    const signatures: string[] = [];
    let confirmed = true;
    const send = async (builder: TransactionBuilder): Promise<boolean> => {
      const result = await sendTx(this.umi, builder);
      signatures.push(result.signature);
      confirmed &&= result.confirmed;
      return result.confirmed;
    };
    try {
      if (!current.exists) {
        // Two transactions: the asset with its plugins, then the page data (size limit).
        const created = await send(
          create(this.umi, {
            asset,
            collection: await this.collection(),
            owner: publicKey(wallet),
            name: grimoireName(wallet),
            uri: `${this.options.publicBaseUrl}/meta/${address}.json`,
            plugins: [
              { type: 'Attributes', attributeList: attributes },
              {
                type: 'AppData',
                dataAuthority: { type: 'Address', address: this.umi.identity.publicKey },
                schema: ExternalPluginAdapterSchema.Binary,
              },
            ],
          }),
        );
        if (created && pages.length > 0) await send(this.writePages(asset, data));
        return { status: confirmed ? 'written' : 'pending', asset: address, signatures };
      }

      const pagesChanged = !sameBytes(encodePages(current.pages), data);
      const attributesChanged = JSON.stringify(current.attributes) !== JSON.stringify(attributes);
      if (!pagesChanged && !attributesChanged) return { status: 'unchanged', asset: address };
      const steps: TransactionBuilder[] = [];
      if (pagesChanged) steps.push(this.writePages(asset, data));
      if (attributesChanged) {
        steps.push(
          updatePlugin(this.umi, {
            asset: asset.publicKey,
            collection: publicKey(this.options.collection),
            plugin: { type: 'Attributes', attributeList: attributes },
          }),
        );
      }
      const combined = transactionBuilder().add(steps);
      if (steps.length > 1 && combined.fitsInOneTransaction(this.umi)) await send(combined);
      else for (const step of steps) await send(step);
      return { status: confirmed ? 'written' : 'pending', asset: address, signatures };
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  async health(): Promise<{ relayer: string; balanceSol: number; collection: string | null }> {
    const balance = await this.umi.rpc.getBalance(this.umi.identity.publicKey);
    return { relayer: this.umi.identity.publicKey.toString(), balanceSol: Number(balance.basisPoints) / 1e9, collection: this.options.collection };
  }
}

export function createChain(config: Config): CoreGrimoires | null {
  if (!config.secretKey || !config.collection) return null;
  return new CoreGrimoires(relayerUmi(config.rpcUrl, config.secretKey), {
    assetSeedSecret: config.assetSeedSecret,
    collection: config.collection,
    publicBaseUrl: config.publicBaseUrl,
  });
}
