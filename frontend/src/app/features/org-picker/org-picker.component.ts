// frontend/src/app/features/org-picker/org-picker.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';
import { Org } from '../../core/models/org.model';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-org-picker',
  standalone: true,
  imports: [CommonModule, LoadingSpinnerComponent],
  template: `
    <div class="org-picker-bg">
      <div class="org-picker-card">
        <div style="text-align:center;margin-bottom:1.75rem;">
          <div style="font-size:32px;margin-bottom:8px;">🏢</div>
          <h1 style="color:#f1f5f9;font-size:20px;font-weight:700;margin:0 0 4px;">Choose a workspace</h1>
          <p style="color:#94a3b8;font-size:13px;margin:0;">Select the organisation you want to work in.</p>
        </div>

        @if (loading()) {
          <app-loading-spinner />
        } @else {
          @for (org of orgs(); track org.id) {
            <div class="org-item" (click)="selectOrg(org)" role="button" tabindex="0"
                 (keydown.enter)="selectOrg(org)">
              <div class="org-item-icon">{{ initial(org) }}</div>
              <div>
                <div class="org-item-name">{{ org.name }}</div>
                <div class="org-item-plan">{{ org.plan }} plan</div>
              </div>
            </div>
          }

          @if (orgs().length === 0) {
            <p style="color:#64748b;text-align:center;font-size:14px;">
              You don't belong to any organisation yet.
            </p>
          }
        }
      </div>
    </div>
  `,
})
export class OrgPickerComponent implements OnInit {
  private tenant = inject(TenantService);
  private router = inject(Router);

  readonly loading = signal(false);
  readonly orgs    = this.tenant.userOrgs;

  ngOnInit(): void {
    this.loading.set(true);
    this.tenant.loadUserOrgs().subscribe({
      next:  () => this.loading.set(false),
      error: () => this.loading.set(false),
    });
  }

  selectOrg(org: Org): void {
    this.tenant.setOrg(org);
    this.router.navigate(['/app']);
  }

  initial(org: Org): string {
    return org.name.charAt(0).toUpperCase();
  }
}
