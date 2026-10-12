import { DEFAULT_TEMPLATES, Recognizer, type Element } from '@grimoire/glyphs';
import { RELAYER_URL } from './config';
import type { Account } from './idos/account';
import { RelayerClient } from './relayer/client';
import { Profile } from './state/profile';

/** Services shared by all scenes once the player has signed in. */
export interface AppContext {
  account: Account;
  profile: Profile;
  relayer: RelayerClient;
  recognizer: Recognizer<Element>;
}

let current: AppContext | null = null;

export function startApp(account: Account): AppContext {
  current = {
    account,
    profile: new Profile(account),
    relayer: new RelayerClient(RELAYER_URL),
    recognizer: new Recognizer(DEFAULT_TEMPLATES),
  };
  return current;
}

export function app(): AppContext {
  if (!current) throw new Error('app() before sign-in');
  return current;
}
