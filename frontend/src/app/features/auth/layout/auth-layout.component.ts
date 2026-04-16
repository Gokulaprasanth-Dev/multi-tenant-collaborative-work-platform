// frontend/src/app/features/auth/layout/auth-layout.component.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="auth-bg">
      <div class="auth-blob-purple"></div>
      <div class="auth-blob-cyan"></div>
      <div class="auth-card">
        <router-outlet />
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
