/**
 * Receipt — email template envoyé au client après un encaissement.
 *
 * Reste volontairement sobre : pas de tracking pixel, pas de CSS exotique
 * (Outlook & Gmail mobile lisent mal), pas d'images sauf le logo data URL
 * (signal de provenance fort + fonctionne offline).
 *
 * Tous les labels sont passés en props pour permettre l'envoi dans n'importe
 * quelle langue sans dupliquer le composant.
 */
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface ReceiptEmailItem {
  name: string;
  qty: number;
  priceCents: number;
}

export interface ReceiptEmailProps {
  salonName: string;
  /** Logo data URL (public Supabase URL ou data: …). Optionnel. */
  logoUrl?: string | null;
  tagline?: string | null;
  addressLine?: string | null;
  /** Sujet déjà localisé (utilisé par <Preview> pour la prévisualisation). */
  previewText: string;
  /** Date longue déjà formatée selon la locale. */
  dateLong: string;
  time: string;
  saleId: string;
  clientName?: string | null;
  items: ReceiptEmailItem[];
  methodLabel: string;
  totalCents: number;
  tipCents?: number;
  /** Devise — passée à Intl.NumberFormat. */
  currency: string;
  /** Tag BCP47 pour les formats nombres / dates. */
  bcp47: string;
  /** URL de l'espace client pour retrouver factures + points fidélité. */
  spaceUrl?: string | null;
  refunded?: boolean;
  // i18n labels
  labels: {
    greeting: string;
    intro: string;
    receiptHeading: string;
    saleNumber: string;
    date: string;
    method: string;
    client: string;
    itemDesc: string;
    qty: string;
    unit: string;
    total: string;
    subtotal: string;
    tip: string;
    grandTotal: string;
    refundedNotice: string;
    accessSpace: string;
    spaceCta: string;
    thanks: string;
    footer: string;
  };
}

function money(cents: number, currency: string, bcp47: string): string {
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function ReceiptEmail(props: ReceiptEmailProps): React.ReactElement {
  const {
    salonName,
    logoUrl,
    tagline,
    addressLine,
    previewText,
    dateLong,
    time,
    saleId,
    clientName,
    items,
    methodLabel,
    totalCents,
    tipCents,
    currency,
    bcp47,
    spaceUrl,
    refunded,
    labels,
  } = props;

  const itemsSubtotal = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  const grandTotal = totalCents + (tipCents ?? 0);

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: '#F5F1EA',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 600,
            margin: '0 auto',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E6DFD3',
            borderRadius: 12,
            padding: '32px 24px',
          }}
        >
          {/* En-tête salon */}
          <Section style={{ textAlign: 'center' }}>
            {logoUrl ? (
              <Img
                src={logoUrl}
                alt={salonName}
                width={64}
                height={64}
                style={{
                  display: 'inline-block',
                  borderRadius: 999,
                  margin: '0 auto 12px',
                  objectFit: 'cover',
                }}
              />
            ) : null}
            <Heading
              as="h1"
              style={{
                fontSize: 22,
                color: '#18160F',
                margin: '0 0 4px',
                fontWeight: 700,
              }}
            >
              {salonName}
            </Heading>
            {tagline ? (
              <Text style={{ fontSize: 13, color: '#8B7E6A', margin: '0 0 4px' }}>{tagline}</Text>
            ) : null}
            {addressLine ? (
              <Text style={{ fontSize: 12, color: '#8B7E6A', margin: '0 0 4px' }}>
                {addressLine}
              </Text>
            ) : null}
          </Section>

          <Hr style={{ borderColor: '#E6DFD3', margin: '24px 0' }} />

          {/* Salutation */}
          <Text style={{ fontSize: 15, color: '#18160F', margin: '0 0 8px' }}>
            {labels.greeting}
            {clientName ? ` ${clientName},` : ''}
          </Text>
          <Text style={{ fontSize: 14, color: '#4A4034', margin: '0 0 16px' }}>{labels.intro}</Text>

          {refunded ? (
            <Section
              style={{
                backgroundColor: '#FDECEC',
                border: '1px solid #F1B5B5',
                color: '#9B1F1F',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              <Text style={{ margin: 0, color: '#9B1F1F' }}>{labels.refundedNotice}</Text>
            </Section>
          ) : null}

          {/* En-tête reçu */}
          <Section
            style={{
              backgroundColor: '#F9F6F0',
              border: '1px solid #E6DFD3',
              borderRadius: 8,
              padding: '14px 16px',
              marginBottom: 18,
            }}
          >
            <Heading
              as="h2"
              style={{ fontSize: 13, color: '#8B7E6A', margin: '0 0 10px', fontWeight: 600 }}
            >
              {labels.receiptHeading}
            </Heading>
            <Row>
              <Column style={{ fontSize: 12, color: '#4A4034' }}>
                <strong>{labels.saleNumber}</strong> {saleId.slice(0, 8).toUpperCase()}
              </Column>
              <Column align="right" style={{ fontSize: 12, color: '#4A4034' }}>
                <strong>{labels.date}</strong> {dateLong} · {time}
              </Column>
            </Row>
            <Row style={{ marginTop: 6 }}>
              <Column style={{ fontSize: 12, color: '#4A4034' }}>
                <strong>{labels.method}</strong> {methodLabel}
              </Column>
              {clientName ? (
                <Column align="right" style={{ fontSize: 12, color: '#4A4034' }}>
                  <strong>{labels.client}</strong> {clientName}
                </Column>
              ) : null}
            </Row>
          </Section>

          {/* Items */}
          <Section>
            <Row
              style={{
                borderBottom: '1px solid #E6DFD3',
                paddingBottom: 6,
                fontSize: 11,
                color: '#8B7E6A',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 600,
              }}
            >
              <Column>{labels.itemDesc}</Column>
              <Column align="right" style={{ width: 40 }}>
                {labels.qty}
              </Column>
              <Column align="right" style={{ width: 80 }}>
                {labels.unit}
              </Column>
              <Column align="right" style={{ width: 90 }}>
                {labels.total}
              </Column>
            </Row>
            {items.map((it, idx) => (
              <Row
                key={`${it.name}-${idx}`}
                style={{
                  borderBottom: '1px solid #F1ECE3',
                  fontSize: 13,
                  color: '#18160F',
                  padding: '8px 0',
                }}
              >
                <Column>{it.name}</Column>
                <Column align="right" style={{ width: 40 }}>
                  {it.qty}
                </Column>
                <Column align="right" style={{ width: 80 }}>
                  {money(it.priceCents, currency, bcp47)}
                </Column>
                <Column align="right" style={{ width: 90 }}>
                  {money(it.priceCents * it.qty, currency, bcp47)}
                </Column>
              </Row>
            ))}
          </Section>

          {/* Sous-total / pourboire / total */}
          <Section style={{ marginTop: 16 }}>
            {tipCents && tipCents > 0 ? (
              <>
                <Row>
                  <Column style={{ fontSize: 13, color: '#4A4034' }}>{labels.subtotal}</Column>
                  <Column align="right" style={{ fontSize: 13, color: '#4A4034' }}>
                    {money(itemsSubtotal, currency, bcp47)}
                  </Column>
                </Row>
                <Row style={{ marginTop: 4 }}>
                  <Column style={{ fontSize: 13, color: '#4A4034' }}>{labels.tip}</Column>
                  <Column align="right" style={{ fontSize: 13, color: '#4A4034' }}>
                    {money(tipCents, currency, bcp47)}
                  </Column>
                </Row>
              </>
            ) : null}
            <Hr style={{ borderColor: '#E6DFD3', margin: '12px 0' }} />
            <Row>
              <Column style={{ fontSize: 16, color: '#18160F', fontWeight: 700 }}>
                {labels.grandTotal}
              </Column>
              <Column align="right" style={{ fontSize: 18, color: '#D08C4F', fontWeight: 700 }}>
                {money(grandTotal, currency, bcp47)}
              </Column>
            </Row>
          </Section>

          {/* CTA espace client */}
          {spaceUrl && !refunded ? (
            <Section style={{ marginTop: 28, textAlign: 'center' }}>
              <Text style={{ fontSize: 13, color: '#4A4034', margin: '0 0 12px' }}>
                {labels.accessSpace}
              </Text>
              <a
                href={spaceUrl}
                style={{
                  display: 'inline-block',
                  backgroundColor: '#D08C4F',
                  color: '#FFFFFF',
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                  padding: '12px 24px',
                  borderRadius: 6,
                }}
              >
                {labels.spaceCta}
              </a>
            </Section>
          ) : null}

          <Hr style={{ borderColor: '#E6DFD3', margin: '28px 0 16px' }} />

          {/* Footer */}
          <Text style={{ fontSize: 13, color: '#4A4034', margin: '0 0 8px' }}>{labels.thanks}</Text>
          <Text style={{ fontSize: 11, color: '#8B7E6A', margin: 0 }}>{labels.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ReceiptEmail;
