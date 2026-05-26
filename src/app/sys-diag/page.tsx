/**
 * /sys-diag — page de diagnostic réservée aux gérants connectés.
 *
 * Affiche l'état brut DB du tenant courant (tenant_branding lu via admin
 * client, contournant RLS) côté serveur, en regard de la session JWT lue par
 * `requireTenant()`. Utile pour vérifier qu'un upload de logo a bien persisté,
 * ou que les couleurs de marque sont à jour en base.
 *
 * Accessible à `/{slug}/sys-diag` (path-based) ou `/sys-diag` (host-based sur
 * un domaine custom). Aucune écriture, lecture seule.
 *
 * Note : le nom n'est pas préfixé par `_` car App Router considère tous les
 * dossiers commençant par underscore comme privés (non routables).
 *
 * À supprimer/déplacer une fois les tickets de diagnostic prod fermés.
 */
import { headers } from 'next/headers';
import { createAdminClient } from '@/db';
import { requireTenant } from '../_data/auth-server';
import { resolveFromHeader } from '../_lib/email-sender';

export const dynamic = 'force-dynamic';

export default async function DebugPage() {
  const ctx = await requireTenant();
  const headersList = await headers();
  const headerSlug = headersList.get('x-tenant-slug') ?? '(absent)';
  const headerTenantId = headersList.get('x-tenant-id') ?? '(absent)';
  const headerHost = headersList.get('host') ?? '(absent)';

  const admin = createAdminClient();
  const { data: branding, error: bErr } = await admin
    .from('tenant_branding')
    .select('*')
    
    .maybeSingle();

  const { data: tenantRow, error: tErr } = await admin
    .from('tenants')
    .select('id, slug, name, plan, status')
    .eq('id', ctx.tenant.id)
    .maybeSingle();

  const logoUrl = (branding as { logo_url?: string | null } | null)?.logo_url ?? null;
  const logoLen = logoUrl ? logoUrl.length : 0;
  const logoHead = logoUrl ? logoUrl.slice(0, 80) : '';

  // Sender email effectif (custom tenant ou fallback env). Permet de verifier
  // que les emails partent bien du domaine attendu.
  const effectiveFrom = await resolveFromHeader(ctx.tenant.id, ctx.tenant.name);

  return (
    <main
      style={{
        padding: '40px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        lineHeight: 1.6,
        maxWidth: '900px',
        margin: '0 auto',
        background: '#FAFAF7',
        color: '#18160F',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: '20px', marginBottom: '24px' }}>/sys-diag — état tenant</h1>

      <Section title="Headers middleware">
        <Row k="host" v={headerHost} />
        <Row k="x-tenant-slug" v={headerSlug} />
        <Row k="x-tenant-id" v={headerTenantId} />
      </Section>

      <Section title="Session JWT (requireTenant)">
        <Row k="user.id" v={ctx.user.id} />
        <Row k="user.email" v={ctx.user.email ?? '(aucun)'} />
        <Row k="tenant.id" v={ctx.tenant.id} />
        <Row k="tenant.slug" v={ctx.tenant.slug} />
        <Row k="tenant.name" v={ctx.tenant.name} />
      </Section>

      <Section title="tenants (admin)">
        {tErr && <Row k="ERROR" v={tErr.message} />}
        {tenantRow ? (
          <>
            <Row k="id" v={(tenantRow as { id: string }).id} />
            <Row k="slug" v={(tenantRow as { slug: string }).slug} />
            <Row k="name" v={(tenantRow as { name: string }).name} />
            <Row k="plan" v={(tenantRow as { plan: string }).plan} />
            <Row k="status" v={(tenantRow as { status: string }).status} />
          </>
        ) : (
          <Row k="(résultat)" v="NULL — pas de ligne" />
        )}
      </Section>

      <Section title="tenant_branding (admin) — c'est ICI qu'on cherche le logo">
        {bErr && <Row k="ERROR" v={bErr.message} />}
        {branding ? (
          <>
            <Row k="tenant_id" v={(branding as { tenant_id: string }).tenant_id} />
            <Row k="brand_primary" v={(branding as { brand_primary: string }).brand_primary} />
            <Row k="brand_glow" v={(branding as { brand_glow: string }).brand_glow} />
            <Row k="brand_deep" v={(branding as { brand_deep: string }).brand_deep} />
            <Row k="logo_url IS NULL" v={logoUrl === null ? 'OUI ❌' : 'NON ✅'} />
            <Row k="logo_url length" v={String(logoLen)} />
            <Row k="logo_url head (80 chars)" v={logoHead || '(vide)'} />
            {logoUrl && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ marginBottom: '6px', color: '#8A8478' }}>Aperçu :</div>
                <img
                  src={logoUrl}
                  alt="logo"
                  style={{
                    width: '120px',
                    height: '120px',
                    objectFit: 'cover',
                    borderRadius: '12px',
                    border: '1px solid #DEDAD3',
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <Row k="(résultat)" v="NULL — pas de ligne tenant_branding !" />
        )}
      </Section>

      <Section title="Diagnostic">
        <p style={{ color: '#8A8478' }}>
          {logoUrl
            ? "✅ Le logo EST en base. Si la page /login ne l'affiche pas, le bug est dans fetchTenantLogo ou la propagation du header x-tenant-id."
            : "❌ Le logo N'EST PAS en base. L'upload via Manager > Paramètres n'a pas persisté (RLS silencieux, schema-cache, ou save non déclenché)."}
        </p>
      </Section>

      {/* Env vars — booléen pour ne pas leak les valeurs. Si un env var
          critique est absent en prod, la feature degrade silencieusement
          (ex. RESEND_API_KEY absent → emails non envoyés mais le RDV reste
          valide). Cette section aide a verifier la config Vercel sans
          avoir a chercher dans le dashboard. */}
      <Section title="Expéditeur emails effectif">
        <Row k="From: header" v={effectiveFrom} />
        <Row
          k="Source"
          v={
            ctx.settings.email_from_address
              ? `tenant_settings.email_from_address (custom)`
              : `RESEND_FROM_EMAIL env var ou fallback noreply@system-aone.com`
          }
        />
        <p style={{ color: '#8A8478', fontSize: '12px', marginTop: '8px' }}>
          {ctx.settings.email_from_address
            ? "⚠️ Vérifier que ce domaine est vérifié dans Resend dashboard (DKIM + SPF + DMARC). Sans vérif Resend rejette l'envoi."
            : 'Configure dans Manager → Paramètres → « Adresse expéditeur des emails » pour un branding personnalisé.'}
        </p>
      </Section>

      <Section title="Configuration runtime (env vars)">
        <Row
          k="RESEND_API_KEY"
          v={hasEnv('RESEND_API_KEY') ? '✅ configuré' : '❌ MANQUANT — emails désactivés'}
        />
        <Row
          k="RESEND_FROM_EMAIL"
          v={hasEnv('RESEND_FROM_EMAIL') ? '✅ configuré' : 'fallback noreply@system-aone.com'}
        />
        <Row
          k="CLIENT_TOKEN_SECRET"
          v={hasEnv('CLIENT_TOKEN_SECRET') ? '✅ configuré' : '❌ MANQUANT — liens email cassés'}
        />
        <Row
          k="CRON_SECRET"
          v={hasEnv('CRON_SECRET') ? '✅ configuré' : '❌ MANQUANT — rappels J-1 désactivés'}
        />
        <Row
          k="VAPID_PUBLIC_KEY"
          v={hasEnv('VAPID_PUBLIC_KEY') ? '✅ configuré' : '⚠️ push notifications désactivées'}
        />
        <Row
          k="VAPID_PRIVATE_KEY"
          v={hasEnv('VAPID_PRIVATE_KEY') ? '✅ configuré' : '⚠️ push notifications désactivées'}
        />
        <Row
          k="UPSTASH_REDIS_REST_URL"
          v={
            hasEnv('UPSTASH_REDIS_REST_URL') ? '✅ configuré' : '⚠️ rate-limit en mémoire fallback'
          }
        />
        <Row
          k="NEXT_PUBLIC_ROOT_URL"
          v={process.env['NEXT_PUBLIC_ROOT_URL'] ?? '(fallback app.system-aone.com)'}
        />
      </Section>
    </main>
  );
}

/** True si l'env var est définie et non vide. Pour les secrets on ne
 *  renvoie JAMAIS la valeur — juste un booléen pour vérifier la config. */
function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: '20px',
        background: '#FFFFFF',
        border: '1px solid #E4E2DC',
        borderRadius: '8px',
        padding: '16px 20px',
      }}
    >
      <h2
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#8A8478',
          marginBottom: '12px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px', padding: '4px 0' }}
    >
      <span style={{ color: '#8A8478' }}>{k}</span>
      <span style={{ wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
