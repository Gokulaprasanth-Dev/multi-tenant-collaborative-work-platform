import { queryPrimary } from '../../src/shared/database/pool';
import { runOffboardingJob } from '../../src/modules/gdpr/workers/offboarding.worker';

export async function forceOffboardOrg(orgId: string): Promise<void> {
  await queryPrimary(
    `UPDATE organizations SET status = 'offboarding', offboarding_started_at = NOW() - INTERVAL '31 days' WHERE id = $1`,
    [orgId]
  );
  await runOffboardingJob({ orgId });
}
