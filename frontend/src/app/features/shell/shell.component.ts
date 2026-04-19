// frontend/src/app/features/shell/shell.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SocketService } from '../../core/services/socket.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ThemeService } from '../../core/services/theme.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TopbarComponent } from './components/topbar/topbar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <app-topbar />
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  private socket = inject(SocketService);
  private ws     = inject(WorkspaceService);
  private theme  = inject(ThemeService);

  ngOnInit(): void {
    this.theme.applyStored();
    this.socket.connect();
    this.ws.load().subscribe();
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }
}
