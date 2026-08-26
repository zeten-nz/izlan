import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaStoragePort } from './media-storage.port';

/**
 * LOCAL DEVELOPMENT/TEST storage adapter. Writes each object to `<root>/<storageKey>` where `storageKey` is an opaque
 * UUID with no extension, path separator, or dot — so the key can never influence the filesystem path (no traversal).
 * Never used in production (the module selects the fail-closed adapter there). The root directory is gitignored.
 */
export class LocalMediaStorageAdapter implements MediaStoragePort {
  constructor(private readonly root: string) {}

  /** Reject anything but an opaque hex/uuid key — defends against path traversal even if a bad key ever reaches here. */
  private objectPath(storageKey: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(storageKey)) {
      throw new Error('invalid storage key');
    }
    return join(this.root, storageKey);
  }

  async put(storageKey: string, bytes: Buffer): Promise<void> {
    const path = this.objectPath(storageKey);
    await mkdir(this.root, { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' }); // wx: never overwrite an existing key
  }

  async read(storageKey: string): Promise<Buffer | null> {
    try {
      return await readFile(this.objectPath(storageKey));
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.objectPath(storageKey));
    } catch {
      /* already gone — idempotent */
    }
  }
}
