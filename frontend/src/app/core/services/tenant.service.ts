// frontend/src/app/core/services/tenant.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { Org } from '../models/org.model';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly activeOrg   = signal<Org | null>(null);
  readonly activeOrgId = computed(() => this.activeOrg()?.id ?? null);

  constructor(private http: HttpClient) {}

  setOrg(org: Org): void {
    this.activeOrg.set(org);
  }

  loadUserOrgs(): Observable<Org[]> {
    return this.http
      .get<ApiResponse<Org[]>>('/api/v1/organizations')
      .pipe(map((res: ApiResponse<Org[]>) => res.data));
  }
}
