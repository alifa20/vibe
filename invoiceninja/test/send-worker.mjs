// Worker for the concurrent numbering test: its own connection, sending its share of drafts.
import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from '../src/db.mjs';
import { sendInvoice } from '../src/invoices.mjs';

const db = openDb(workerData.file, { busyTimeout: 10000 });
const numbers = workerData.ids.map((id) => sendInvoice(db, id, workerData.now));
db.close();
parentPort.postMessage(numbers);
