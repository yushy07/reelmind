import fs from 'node:fs/promises';
import sharp from 'sharp';

// Generate Windows icon sizes from the original vector mark.
const source = await fs.readFile(new URL('../assets/logo.svg', import.meta.url));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, i) => {
  const position = 6 + i * 16;
  header[position] = sizes[i] === 256 ? 0 : sizes[i];
  header[position + 1] = header[position];
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(data.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += data.length;
});
await fs.writeFile('assets/icon.png', images.at(-1));
await fs.writeFile('assets/icon.ico', Buffer.concat([header, ...images]));
