import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Store, atomicJSON, hash } from './storage';

export const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function seal(file: string): Promise<void> {
  await fs.writeFile(file + '.sha256', await hash(file), 'utf8');
}

export async function checkpoint<T>(
  store: Store,
  file: string,
  validate: (data: any) => boolean,
  generate: () => Promise<T>,
  dependency?: string
): Promise<T> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    const expected = (await fs.readFile(file + '.sha256', 'utf8')).trim();
    const matches = !dependency || (await fs.readFile(file + '.dependency', 'utf8')) === dependency;
    if (matches && validate(value) && expected === (await hash(file))) return value;
  } catch {}
  const value = await generate();
  await atomicJSON(file, value);
  await seal(file);
  if (dependency) await fs.writeFile(file + '.dependency', dependency, 'utf8');
  return value;
}

export async function invalidate(...files: string[]): Promise<void> {
  for (const f of files) {
    await fs.unlink(f + '.sha256').catch(() => {});
    await fs.unlink(f + '.dependency').catch(() => {});
    await fs.unlink(f).catch(() => {});
  }
}

export class CheckpointStore {
  constructor(public store?: Store) {}

  fingerprint(value: unknown): string {
    return fingerprint(value);
  }

  async seal(file: string): Promise<void> {
    return seal(file);
  }

  async checkpoint<T>(
    file: string,
    validate: (data: any) => boolean,
    generate: () => Promise<T>,
    dependency?: string
  ): Promise<T> {
    return checkpoint(this.store!, file, validate, generate, dependency);
  }

  async invalidate(...files: string[]): Promise<void> {
    return invalidate(...files);
  }
}
