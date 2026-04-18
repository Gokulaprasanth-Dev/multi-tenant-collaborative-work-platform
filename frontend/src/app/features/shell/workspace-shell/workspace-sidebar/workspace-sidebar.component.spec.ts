// frontend/src/app/features/shell/workspace-shell/workspace-sidebar/workspace-sidebar.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { WorkspaceSidebarComponent } from './workspace-sidebar.component';
import { WorkspaceService } from '../../../../core/services/workspace.service';
import { ChannelService } from '../../../../core/services/channel.service';
import { Workspace } from '../../../../core/models/workspace.model';
import { Channel } from '../../../../core/models/channel.model';

const WS: Workspace = {
  id: 'ws-1', orgId: 'org-1', name: 'Engineering', description: null,
  status: 'active', ownerUserId: 'u-1', version: 1,
  createdAt: '', updatedAt: '',
};

const CH: Channel = {
  id: 'ch-1', orgId: 'org-1', workspaceId: 'ws-1',
  type: 'group', name: 'general', createdAt: '',
};

describe('WorkspaceSidebarComponent', () => {
  let fixture: ComponentFixture<WorkspaceSidebarComponent>;
  let wsSvc: { activeWorkspace: ReturnType<typeof signal<Workspace | null>>; loadOne: jest.Mock };
  let chSvc: { channels: ReturnType<typeof signal<Channel[]>>; load: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    wsSvc = {
      activeWorkspace: signal<Workspace | null>(null),
      loadOne:         jest.fn().mockReturnValue(of(WS)),
    };
    chSvc = {
      channels: signal<Channel[]>([]),
      load:     jest.fn().mockReturnValue(of([])),
      create:   jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceSidebarComponent],
      providers: [
        { provide: WorkspaceService, useValue: wsSvc },
        { provide: ChannelService,   useValue: chSvc },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceSidebarComponent);
    fixture.componentRef.setInput('workspaceId', 'ws-1');
    fixture.detectChanges();
  });

  it('renders the back link pointing to /app/workspaces', () => {
    const back = fixture.nativeElement.querySelector('.workspace-sidebar-back');
    expect(back).toBeTruthy();
    expect(back.getAttribute('href')).toBe('/app/workspaces');
  });

  it('renders workspace name when activeWorkspace is set', fakeAsync(() => {
    wsSvc.activeWorkspace.set(WS);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Engineering');
  }));

  it('renders a link for each channel in the signal', fakeAsync(() => {
    chSvc.channels.set([CH]);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('a.workspace-sidebar-item');
    const texts = Array.from<Element>(items).map(el => el.textContent);
    expect(texts.some(t => t?.includes('general'))).toBe(true);
  }));

  it('has a Tasks link pointing to /app/workspaces/ws-1/tasks', () => {
    const links = fixture.nativeElement.querySelectorAll('a.workspace-sidebar-item');
    const hrefs = Array.from<Element>(links).map(el => el.getAttribute('href'));
    expect(hrefs.some((h: string | null) => h?.includes('/app/workspaces/ws-1/tasks'))).toBe(true);
  });
});
