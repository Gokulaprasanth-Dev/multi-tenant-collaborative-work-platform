// frontend/src/app/core/models/org.model.ts

export interface Org {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'offboarding' | 'cancelled';
  plan: string;
}

// Shape returned by the backend (snake_case)
export interface OrgDto {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'offboarding' | 'deleted';
  plan_tier: string;
}

export function toOrg(dto: OrgDto): Org {
  return {
    id:     dto.id,
    name:   dto.name,
    slug:   dto.slug,
    status: dto.status === 'deleted' ? 'cancelled' : dto.status,
    plan:   dto.plan_tier,
  };
}
