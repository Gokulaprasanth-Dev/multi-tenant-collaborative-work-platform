// frontend/src/app/core/services/tenant.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs';
import { Org, OrgDto, toOrg } from '../models/org.model';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class TenantService {
  readonly activeOrg   = signal<Org | null>(null);
  readonly activeOrgId = computed(() => this.activeOrg()?.id ?? null);
  /** All orgs the user is a member of — populated by loadUserOrgs() */
  readonly userOrgs    = signal<Org[]>([]);

  constructor(private http: HttpClient) {}

  setOrg(org: Org): void {
    this.activeOrg.set(org);
  }

  loadUserOrgs(): Observable<Org[]> {
    return this.http
      .get<ApiResponse<OrgDto[]>>('/api/v1/orgs/mine')
      .pipe(
        map((res: ApiResponse<OrgDto[]>) => res.data.map(toOrg)),
        tap((orgs: Org[]) => this.userOrgs.set(orgs)),
      );
  }
}
