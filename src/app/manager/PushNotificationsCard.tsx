'use client';

/**
 * PushNotificationsCard — bouton d'activation des notifications push (PWA).
 *
 * Affiché dans Manager > Paramètres. Trois états :
 *  - Non supporté par le navigateur (iOS < 16, Safari très ancien) → message
 *  - Pas configuré côté serveur (VAPID absent) → message + désactivé
 *  - Supporté : bouton Activer/Désactiver selon l'état de souscription actuel
 *
 * Au clic Activer : demande la permission Notification, enregistre le SW si
 * besoin, s'abonne via PushManager, POST la subscription au serveur.
 * Au clic Désactiver : retire le row côté serveur + push manager unsubscribe.
 */
import { Bell, BellOff, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Btn } from '@/components';
import { useToast } from '../_components/Toast';
import {
  countPushSubscriptions,
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
} from './push-actions';

/** Convertit une base64url en Uint8Array (format attendu par PushManager). */
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

type State = 'loading' | 'unsupported' | 'unconfigured' | 'idle' | 'subscribed';

export function PushNotificationsCard() {
  const t = useTranslations('manager.push');
  const toast = useToast();
  const [state, setState] = useState<State>('loading');
  const [count, setCount] = useState<{ total: number; mine: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported');
      return;
    }
    const keyRes = await getPushPublicKey();
    if (!keyRes.ok) {
      setState('unconfigured');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setState(existing ? 'subscribed' : 'idle');
    } catch {
      setState('idle');
    }
    const c = await countPushSubscriptions();
    if (c.ok) setCount({ total: c.total, mine: c.myCount });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = () => {
    startTransition(async () => {
      const keyRes = await getPushPublicKey();
      if (!keyRes.ok) {
        toast.error(t('errorNotConfigured'));
        setState('unconfigured');
        return;
      }
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = 'denied';
      }
      if (permission !== 'granted') {
        toast.error(t('errorPermissionDenied'));
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast volontaire — `applicationServerKey` accepte un BufferSource ;
          // les types DOM exigent ArrayBuffer "pur" mais l'API runtime se
          // contente d'un Uint8Array. Cf. https://w3c.github.io/push-api/#dom-pushmanager-subscribe
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) as unknown as BufferSource,
        });
        const json = sub.toJSON();
        const res = await subscribePush({
          endpoint: json.endpoint ?? sub.endpoint,
          keys: {
            p256dh: json['keys']?.['p256dh'] ?? '',
            auth: json['keys']?.['auth'] ?? '',
          },
          userAgent: navigator.userAgent.slice(0, 500),
        });
        if (!res.ok) {
          toast.error(t('errorEnableFailed'));
          // Rollback côté navigateur — sinon on aurait une souscription
          // serveur-less qui empêcherait de re-tenter proprement.
          await sub.unsubscribe().catch(() => {});
          return;
        }
        toast.success(t('toastEnabled'));
        setState('subscribed');
        await refresh();
      } catch {
        toast.error(t('errorEnableFailed'));
      }
    });
  };

  const disable = () => {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await unsubscribePush(existing.endpoint);
          await existing.unsubscribe();
        }
        toast.success(t('toastDisabled'));
        setState('idle');
        await refresh();
      } catch {
        toast.error(t('errorDisableFailed'));
      }
    });
  };

  return (
    <div className="border-line bg-surface rounded-sm border p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="bg-brand-primary/12 text-brand-primary flex h-9 w-9 items-center justify-center rounded-full">
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <h4 className="display text-lg">{t('title')}</h4>
          <p className="text-ink-mute mt-1 text-xs">{t('subtitle')}</p>
        </div>
      </div>

      {state === 'loading' && <p className="text-ink-soft text-xs">{t('loading')}</p>}

      {state === 'unsupported' && (
        <p className="border-line/60 bg-bg-soft text-ink-mute rounded-sm border px-3 py-2 text-xs">
          {t('unsupported')}
        </p>
      )}

      {state === 'unconfigured' && (
        <p className="border-line/60 bg-bg-soft text-ink-mute rounded-sm border px-3 py-2 text-xs">
          {t('notConfigured')}
        </p>
      )}

      {state === 'idle' && (
        <div className="flex flex-col gap-3">
          <Btn icon={Bell} onClick={enable} disabled={pending}>
            {pending ? t('enabling') : t('enableBtn')}
          </Btn>
        </div>
      )}

      {state === 'subscribed' && (
        <div className="flex flex-col gap-3">
          <div className="border-green/30 bg-green/8 text-green flex items-center gap-2 rounded-sm border px-3 py-2 text-xs">
            <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>{t('subscribed')}</span>
          </div>
          {count && count.total > 0 && (
            <p className="text-ink-soft mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
              <Smartphone className="h-3 w-3" strokeWidth={1.75} />
              {count.total > 1
                ? t('devicesMany', { count: count.total })
                : t('devicesOne', { count: count.total })}
            </p>
          )}
          <Btn variant="secondary" icon={BellOff} onClick={disable} disabled={pending}>
            {pending ? t('disabling') : t('disableBtn')}
          </Btn>
        </div>
      )}
    </div>
  );
}
