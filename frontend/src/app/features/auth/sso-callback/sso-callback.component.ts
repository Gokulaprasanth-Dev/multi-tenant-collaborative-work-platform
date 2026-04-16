// frontend/src/app/features/auth/sso-callback/sso-callback.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-sso-callback',
  standalone: true,
  imports: [LoadingSpinnerComponent],
  template: `<app-loading-spinner [full]="true" />`,
})
export class SsoCallbackComponent implements OnInit {
  constructor(
    private route:  ActivatedRoute,
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.router.navigate(['/auth/login']); return; }
    this.auth.handleSsoToken(token);
    this.router.navigate(['/app']);
  }
}
