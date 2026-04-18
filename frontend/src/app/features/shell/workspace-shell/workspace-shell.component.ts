// frontend/src/app/features/shell/workspace-shell/workspace-shell.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ChannelService } from '../../../core/services/channel.service';
import { WorkspaceSidebarComponent } from './workspace-sidebar/workspace-sidebar.component';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [RouterOutlet, WorkspaceSidebarComponent],
  template: `
    <div class="workspace-shell">
      <app-workspace-sidebar [workspaceId]="workspaceId" />
      <main class="workspace-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class WorkspaceShellComponent implements OnInit {
  private route  = inject(ActivatedRoute);
  private wsSvc  = inject(WorkspaceService);
  private chSvc  = inject(ChannelService);

  workspaceId = '';

  ngOnInit(): void {
    this.workspaceId = this.route.snapshot.paramMap.get('id')!;
    this.wsSvc.loadOne(this.workspaceId).subscribe();
    this.chSvc.load(this.workspaceId).subscribe();
  }
}
