import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const secrets = { ASSET_SEED_SECRET: 'seed-secret-seed-secret', TOKEN_HMAC_SECRET: 'hmac-secret-hmac-secret' };

describe('loadConfig', () => {
  it('links metadata to PUBLIC_BASE_URL when run locally', () => {
    expect(loadConfig({ ...secrets, PUBLIC_BASE_URL: 'http://localhost:8787/' }).publicBaseUrl).toBe('http://localhost:8787');
  });

  it('links metadata to the production domain on Vercel, whatever PUBLIC_BASE_URL says', () => {
    const env = { ...secrets, PUBLIC_BASE_URL: 'https://old.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'acrunee.vercel.app' };
    expect(loadConfig(env).publicBaseUrl).toBe('https://acrunee.vercel.app');
  });

  it('needs one of them', () => {
    expect(() => loadConfig(secrets)).toThrow(/PUBLIC_BASE_URL/);
  });
});
