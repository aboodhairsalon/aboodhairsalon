/**
 * File d'attente des ventes hors-ligne — IndexedDB (durable, survit au reload
 * et à la fermeture de l'onglet).
 *
 * Quand la caisse encaisse sans réseau, la vente est enregistrée ici AVANT
 * toute tentative serveur. Le moteur de synchro la rejoue à la reconnexion
 * (cf. CashierApp). La clé `offlineClientId` (uuid) sert d'idempotence côté
 * serveur (`sales.offline_client_id` unique) → un rejeu ne crée jamais de
 * doublon, et une vente ne peut pas être perdue (durable avant l'appel réseau).
 *
 * Tolérant : toute erreur IndexedDB (mode privé strict, quota) dégrade sans
 * planter — `getQueuedSales`/`countQueuedSales` renvoient une valeur vide.
 */
import type { CreateDirectSaleInput, PayBookingInput } from '../manager/booking-actions';

export type QueuedSale = {
  /** Clé d'idempotence (uuid) — keyPath du store + sales.offline_client_id. */
  offlineClientId: string;
  /** ID local de la vente optimiste (sales[].id côté caisse) — pour réconcilier. */
  localId: string;
  createdAt: number;
  /** Nb de tentatives de synchro échouées (validation) — garde anti-boucle. */
  attempts: number;
} & (
  | { action: 'createDirectSale'; payload: CreateDirectSaleInput }
  | { action: 'payBooking'; payload: PayBookingInput }
);

const DB_NAME = 'aboodhairsalon-offline';
const STORE = 'pending-sales';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'offlineClientId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx<T>(
  mode: IDBTransactionMode,
  build: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = build(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Ajoute (ou remplace) une vente en attente. À appeler AVANT l'appel serveur. */
export async function enqueueSale(item: QueuedSale): Promise<void> {
  await runTx('readwrite', (s) => s.put(item) as IDBRequest<IDBValidKey>);
}

/** Toutes les ventes en attente (les plus anciennes d'abord). */
export async function getQueuedSales(): Promise<QueuedSale[]> {
  try {
    const all = (await runTx<QueuedSale[]>('readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** Retire une vente synchronisée. */
export async function removeQueuedSale(offlineClientId: string): Promise<void> {
  try {
    await runTx('readwrite', (s) => s.delete(offlineClientId) as IDBRequest<undefined>);
  } catch {
    /* dégrade silencieusement */
  }
}

/** Nombre de ventes en attente (badge « X à synchroniser »). */
export async function countQueuedSales(): Promise<number> {
  try {
    return (await runTx<number>('readonly', (s) => s.count())) ?? 0;
  } catch {
    return 0;
  }
}

/** Incrémente le compteur de tentatives (rejet de validation au rejeu). */
export async function bumpAttempts(item: QueuedSale): Promise<void> {
  try {
    await runTx('readwrite', (s) =>
      s.put({ ...item, attempts: (item.attempts ?? 0) + 1 }) as IDBRequest<IDBValidKey>,
    );
  } catch {
    /* dégrade silencieusement */
  }
}
