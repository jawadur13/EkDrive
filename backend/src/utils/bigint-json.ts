// Prisma returns BigInt for byte counts, which JSON.stringify rejects. Send them as numbers:
// exact up to 2^53 bytes (8 PiB), far beyond any Google Drive quota.
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

BigInt.prototype.toJSON = function () {
  return Number(this);
};

export {};
