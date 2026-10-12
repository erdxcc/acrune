/** Requests devnet SOL for the relayer key: pnpm airdrop [amount]. */
import { sol } from '@metaplex-foundation/umi';
import { loadConfig } from '../src/config';
import { relayerUmi } from '../src/solana';

const config = loadConfig();
const umi = relayerUmi(config.rpcUrl, config.secretKey);
const amount = Number(process.argv[2] ?? 1);
try {
  await umi.rpc.airdrop(umi.identity.publicKey, sol(amount));
  console.log(`Airdropped ${amount} SOL`);
} catch (e) {
  console.error(`Airdrop failed (the public faucet is rate-limited; try https://faucet.solana.com): ${e instanceof Error ? e.message : e}`);
}
const balance = await umi.rpc.getBalance(umi.identity.publicKey);
console.log(`${umi.identity.publicKey}: ${Number(balance.basisPoints) / 1e9} SOL`);
