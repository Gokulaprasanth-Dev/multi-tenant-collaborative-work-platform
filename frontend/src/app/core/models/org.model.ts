// frontend/src/app/core/models/org.model.ts
export interface Org {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'cancelled';
  plan: string;
}
