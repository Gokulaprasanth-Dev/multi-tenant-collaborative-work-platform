// frontend/src/app/features/settings/settings.component.ts
import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div style="display:flex;gap:0;height:100%;min-height:calc(100vh - 56px);">
      <!-- Left nav -->
      <nav style="width:200px;flex-shrink:0;border-right:1px solid rgba(255,255,255,0.06);padding:8px 0;">
        <div class="sidebar-section-label">Settings</div>
        <a class="sidebar-nav-item" routerLink="profile"      routerLinkActive="active">
          <span class="nav-icon">👤</span>
          <span class="nav-label">Profile</span>
        </a>
        <a class="sidebar-nav-item" routerLink="security"     routerLinkActive="active">
          <span class="nav-icon">🔒</span>
          <span class="nav-label">Security</span>
        </a>
        <a class="sidebar-nav-item" routerLink="preferences"  routerLinkActive="active">
          <span class="nav-icon">🎨</span>
          <span class="nav-label">Preferences</span>
        </a>
        <a class="sidebar-nav-item" routerLink="notifications" routerLinkActive="active">
          <span class="nav-icon">🔔</span>
          <span class="nav-label">Notifications</span>
        </a>
      </nav>

      <!-- Content -->
      <div style="flex:1;padding:2rem;overflow-y:auto;max-width:720px;">
        <router-outlet />
      </div>
    </div>
  `,
})
export class SettingsComponent {}
