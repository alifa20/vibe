/**
 * The daily salt behind visitor counting.
 *
 * A fresh random salt is made for each UTC day. It lives in memory and in one
 * database row (so a restart mid-day keeps counting the same visitors), and is
 * deleted as soon as the day is over. Without it, a stored hash cannot be tied
 * back to an IP and user agent, not even by whoever runs the server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { dayKey } from './db.mjs';

export function createSaltStore(db, clock) {
  const read = db.prepare('SELECT day, salt FROM salts WHERE day = ?');
  const insert = db.prepare('INSERT INTO salts (day, salt) VALUES (?, ?)');
  const dropOthers = db.prepare('DELETE FROM salts WHERE day <> ?');

  let current = null;
  let dropped = 0;

  const rotateTx = db.transaction((day) => {
    dropped = dropOthers.run(day).changes;
    const stored = read.get(day);
    if (stored) {
      current = { day, salt: Buffer.from(stored.salt) };
    } else {
      current = { day, salt: randomBytes(32) };
      insert.run(day, current.salt);
    }
    return current;
  });

  /**
   * secure_delete zeroes the old salt's bytes in the page it lived on, but in
   * WAL mode the earlier versions of that page stay in the -wal file until a
   * checkpoint. TRUNCATE copies the zeroed page into the database and empties
   * the WAL. If another connection is mid-read the checkpoint cannot finish;
   * the old frames are then overwritten by later checkpoints instead.
   */
  function rotate(day) {
    const result = rotateTx(day);
    if (dropped && !db.memory) db.pragma('wal_checkpoint(TRUNCATE)');
    return result;
  }

  return {
    /**
     * Today's salt, rotating first if the UTC day has changed. Pass the event
     * time so the salt and the event's day column always agree.
     */
    current (now = clock.now()) {
      const day = dayKey(now);
      return current && current.day === day ? current : rotate(day);
    },
    /** Called on a timer so an old salt is deleted even when no hits arrive. */
    rotate () {
      return this.current();
    }
  };
}

/** SHA-256 over salt, site, IP and user agent, truncated to 64 bits. */
export function visitorHash(salt, domain, ip, ua) {
  return createHash('sha256')
    .update(salt)
    .update('\0').update(domain)
    .update('\0').update(ip)
    .update('\0').update(ua)
    .digest('hex')
    .slice(0, 16);
}
