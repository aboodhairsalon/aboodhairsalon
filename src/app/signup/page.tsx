/**
 * Page `/signup` — wrapper Server Component qui rend le form client.
 *
 * Force le rendu dynamique : la Server Action `signUp` est appelée depuis
 * un Client Component voisin, mais le prerender SSG cause un TDZ webpack
 * (cf. https://github.com/vercel/next.js/issues/65816). En forçant le mode
 * dynamic, Next.js skip le prerender → build clean.
 */
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return <SignupForm />;
}
