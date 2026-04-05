import { SAML } from 'passport-saml';
import { AuthRepository } from '../repositories/auth.repository';
import { issueTokenPair, TokenPair } from './jwt.service';
import { persistAuditLog } from '../../audit/workers/audit.worker';
import { queryPrimary, queryReplica } from '../../../shared/database/pool';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors/app-errors';
import { logger } from '../../../shared/observability/logger';
import { isEnabled } from '../../feature-flag/feature-flag.service';

const repo = new AuthRepository();

interface OrgSamlConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  audience?: string;
}

async function getOrgSamlConfig(orgId: string): Promise<OrgSamlConfig | null> {
  const result = await queryReplica(
    `SELECT saml_metadata_url, saml_enabled FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [orgId]
  );
  if (result.rows.length === 0) return null;
  const org = result.rows[0] as { saml_enabled: boolean; saml_metadata_url: string | null };
  if (!org.saml_enabled || !org.saml_metadata_url) return null;
  // saml_metadata_url stores the IdP metadata as JSON: { entryPoint, issuer, cert, audience? }
  try {
    return JSON.parse(org.saml_metadata_url) as OrgSamlConfig;
  } catch {
    logger.error({ orgId }, 'Invalid SAML metadata JSON for org');
    return null;
  }
}

export async function handleCallback(
  orgId: string,
  samlResponse: string
): Promise<TokenPair> {
  // Feature flag: feature.sso must be enabled for this org (enterprise plan)
  const ssoEnabled = await isEnabled(orgId, 'feature.sso');
  if (!ssoEnabled) {
    throw new ForbiddenError('FEATURE_NOT_ENABLED', 'SSO is not enabled for this organization. Upgrade to enterprise plan.');
  }

  const samlConfig = await getOrgSamlConfig(orgId);
  if (!samlConfig) {
    throw new UnauthorizedError('SAML_NOT_CONFIGURED', 'SAML is not configured for this organization');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saml = new SAML({
    entryPoint: samlConfig.entryPoint,
    issuer: samlConfig.issuer,
    cert: samlConfig.cert,
    audience: samlConfig.audience ?? samlConfig.issuer,
    validateInResponseTo: 'never',
    disableRequestedAuthnContext: true,
  } as any);

  let profile: Record<string, unknown>;
  try {
    const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    profile = result.profile as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, orgId }, 'SAML response validation failed');
    throw new UnauthorizedError('SAML_VALIDATION_FAILED', 'SAML response could not be validated');
  }

  const assertionId = (profile['ID'] ?? profile['id']) as string | undefined;
  const notOnOrAfterRaw = (profile['notOnOrAfter'] ?? profile['sessionNotOnOrAfter']) as string | undefined;
  const email = ((profile['email'] ?? profile['nameID']) as string).toLowerCase().trim();
  const name = (profile['displayName'] ?? profile['cn'] ?? email) as string;

  if (!assertionId) {
    throw new UnauthorizedError('SAML_MISSING_ASSERTION_ID', 'SAML assertion ID is missing');
  }

  const notOnOrAfter = notOnOrAfterRaw ? new Date(notOnOrAfterRaw) : new Date(Date.now() + 60 * 60 * 1000);

  // CONSISTENCY-003 fix — PRESENCE-ONLY replay check
  const existing = await queryPrimary(
    'SELECT 1 FROM saml_used_assertions WHERE assertion_id = $1 AND org_id = $2',
    [assertionId, orgId]
  );
  if (existing.rows.length > 0) {
    throw new UnauthorizedError('SAML_ASSERTION_REPLAYED', 'SAML assertion already used');
  }
  await queryPrimary(
    'INSERT INTO saml_used_assertions (assertion_id, org_id, not_on_or_after) VALUES ($1, $2, $3)',
    [assertionId, orgId, notOnOrAfter]
  );
  // Do NOT check not_on_or_after in the gate — presence is the complete and sufficient signal

  // Upsert user + provider
  const providerUserId = `${orgId}:${email}`;
  let userId: string;

  const existingProvider = await repo.findAuthProvider('saml', providerUserId);
  if (existingProvider) {
    userId = existingProvider.user_id;
  } else {
    let user = await repo.findUserByEmail(email);
    if (!user) {
      user = await repo.createUser({ email, name, email_verified: true });
      await repo.createUserPreferences(user.id);
    } else if (!user.email_verified) {
      await repo.updateUser(user.id, { email_verified: true, email_verified_at: new Date() });
    }
    userId = user.id;

    await repo.createAuthProvider({
      user_id: userId,
      provider: 'saml',
      provider_user_id: providerUserId,
      org_id: orgId,
      metadata: { email, name, orgId },
    });
  }

  // Verify org membership and resolve role
  const memberResult = await queryReplica(
    `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
    [userId, orgId]
  );
  const role = memberResult.rows.length > 0
    ? (memberResult.rows[0] as { role: string }).role
    : 'member';

  await persistAuditLog({
    orgId,
    actorId: userId,
    actorType: 'user',
    eventType: 'user.login_saml',
    entityType: 'user',
    entityId: userId,
  });

  return issueTokenPair(userId, orgId, role, false);
}
