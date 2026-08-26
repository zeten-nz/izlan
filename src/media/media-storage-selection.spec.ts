import { selectMediaStorage } from './media.module';
import { LocalMediaStorageAdapter } from './storage/local-media-storage.adapter';
import { UnavailableMediaStorageAdapter } from './storage/unavailable-media-storage.adapter';
import type { MediaStoragePort } from './storage/media-storage.port';
import { MediaStorageUnavailableError } from '../common/errors';

/**
 * §5 storage driver safety. Local disk is a dev/test convenience only; production MUST fail closed (never silently fall
 * back to writing binaries onto an ephemeral server disk). No test here touches the real filesystem.
 */
describe('selectMediaStorage (§5 fail-closed)', () => {
  const saved = { driver: process.env.MEDIA_STORAGE_DRIVER, env: process.env.NODE_ENV, root: process.env.MEDIA_LOCAL_ROOT };
  afterEach(() => {
    process.env.MEDIA_STORAGE_DRIVER = saved.driver;
    process.env.NODE_ENV = saved.env;
    process.env.MEDIA_LOCAL_ROOT = saved.root;
  });

  it('MEDIA-SEL-01 driver=local in development → local disk adapter', () => {
    process.env.MEDIA_STORAGE_DRIVER = 'local';
    process.env.NODE_ENV = 'development';
    process.env.MEDIA_LOCAL_ROOT = require('node:os').tmpdir();
    expect(selectMediaStorage()).toBeInstanceOf(LocalMediaStorageAdapter);
  });

  it('MEDIA-SEL-02 driver=local in PRODUCTION → fail-closed adapter (never local disk)', () => {
    process.env.MEDIA_STORAGE_DRIVER = 'local';
    process.env.NODE_ENV = 'production';
    expect(selectMediaStorage()).toBeInstanceOf(UnavailableMediaStorageAdapter);
  });

  it('MEDIA-SEL-03 no/unknown driver → fail-closed adapter', () => {
    process.env.NODE_ENV = 'development';
    process.env.MEDIA_STORAGE_DRIVER = '';
    expect(selectMediaStorage()).toBeInstanceOf(UnavailableMediaStorageAdapter);
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    expect(selectMediaStorage()).toBeInstanceOf(UnavailableMediaStorageAdapter);
  });

  it('MEDIA-SEL-04 fail-closed adapter rejects writes with MEDIA_STORAGE_UNAVAILABLE but never crashes on read', async () => {
    const adapter: MediaStoragePort = new UnavailableMediaStorageAdapter();
    await expect(adapter.put('some-key', Buffer.from('x'))).rejects.toBeInstanceOf(MediaStorageUnavailableError);
    await expect(adapter.read('any-key')).resolves.toBeNull();
  });
});
