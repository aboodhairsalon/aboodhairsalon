'use client';
/**
 * Hook `usePersistedCollection` — synchronise une collection éditée localement
 * (useState classique) avec la DB via Server Actions.
 *
 * Problème résolu : les composants Manager (TeamBarbersSection, ManagerServices…)
 * font des `setData((prev) => ...)` purs. On veut persister sans réécrire tous
 * ces composants.
 *
 * Mécanique :
 *  - `data` est un useState seedé depuis la collection serveur.
 *  - Quand le serveur recharge (revalidatePath → layout re-render → `initial`
 *    change), on resync `data` ET le ref `lastPersisted` → diff vide.
 *  - Quand l'utilisateur édite (`setData`), un effet compare `data` vs
 *    `lastPersisted`, calcule create/update/delete, et tire les Server Actions.
 *
 * En mode démo (`enabled=false`), aucune persistance — useState pur.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CrudErrorCode, CrudErrorValues, MutationResult } from './crud-actions';

type WithId = { id: string };

export type PersistOps<T> = {
  create: (item: T) => Promise<MutationResult>;
  update: (id: string, item: T) => Promise<MutationResult>;
  remove: (id: string) => Promise<MutationResult>;
};

/** Signature i18n-friendly du callback d'erreur : reçoit un code + valeurs
 *  d'interpolation, l'appelant les résout via useTranslations. */
export type PersistErrorHandler = (
  errorKey: CrudErrorCode,
  errorValues: CrudErrorValues | undefined,
) => void;

export function usePersistedCollection<T extends WithId>(
  initial: T[],
  enabled: boolean,
  ops: PersistOps<T>,
  onError?: PersistErrorHandler,
  /**
   * Appelé une fois après qu'au moins un item a été créé avec succès côté
   * serveur. Utilisation typique : `router.refresh()` pour remplacer les
   * IDs temporaires (fake) par les vrais UUIDs Supabase.
   */
  onCreated?: () => void,
): [T[], Dispatch<SetStateAction<T[]>>] {
  const [data, setData] = useState<T[]>(initial);
  const lastPersisted = useRef<T[]>(initial);
  // Garde une ref des ops pour ne pas relancer l'effet à chaque render.
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  // Resync quand le serveur recharge la collection (initial change d'identité).
  useEffect(() => {
    setData(initial);
    lastPersisted.current = initial;
  }, [initial]);

  // Persistance : diff data vs lastPersisted après chaque édition utilisateur.
  useEffect(() => {
    if (!enabled) return;
    const prev = lastPersisted.current;
    if (prev === data) return; // resync ou premier render → rien à persister

    const prevById = new Map(prev.map((x) => [x.id, x]));
    const nextById = new Map(data.map((x) => [x.id, x]));

    const created = data.filter((x) => !prevById.has(x.id));
    const removed = prev.filter((x) => !nextById.has(x.id));
    const updated = data.filter((x) => {
      const p = prevById.get(x.id);
      return p && JSON.stringify(p) !== JSON.stringify(x);
    });

    lastPersisted.current = data;

    void (async () => {
      let anyCreated = false;
      for (const item of created) {
        const r = await opsRef.current.create(item);
        if (!r.ok) onErrorRef.current?.(r.errorKey, r.errorValues);
        else anyCreated = true;
      }
      for (const item of updated) {
        const r = await opsRef.current.update(item.id, item);
        if (!r.ok) onErrorRef.current?.(r.errorKey, r.errorValues);
      }
      for (const item of removed) {
        const r = await opsRef.current.remove(item.id);
        if (!r.ok) onErrorRef.current?.(r.errorKey, r.errorValues);
      }
      // Après une création réussie : le serveur a généré un vrai UUID (≠ ID
      // temporaire côté client). On déclenche un refresh pour resynchroniser
      // avec les vrais identifiants DB et éviter les échecs aval (ex. UUID
      // validation dans createCashierAccess).
      if (anyCreated) onCreatedRef.current?.();
    })();
  }, [data, enabled]);

  return [data, setData];
}
