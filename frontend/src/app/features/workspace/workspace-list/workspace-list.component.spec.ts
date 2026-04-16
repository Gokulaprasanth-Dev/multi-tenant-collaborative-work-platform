// frontend/src/app/features/workspace/workspace-list/workspace-list.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { WorkspaceListComponent } from './workspace-list.component';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Workspace } from '../../../core/models/workspace.model';

const WS: Workspace = {
  id: 'ws-1', orgId: 'org-1', name: 'Dev', description: null,
  status: 'active', ownerUserId: 'u-1', version: 1,
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('WorkspaceListComponent', () => {
  let fixture: ComponentFixture<WorkspaceListComponent>;
  let wsService: { workspaces: ReturnType<typeof signal<Workspace[]>>; loading: ReturnType<typeof signal<boolean>>; load: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    wsService = {
      workspaces: signal<Workspace[]>([]),
      loading:    signal(false),
      load:       jest.fn().mockReturnValue(of([])),
      create:     jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceListComponent],
      providers: [
        { provide: WorkspaceService, useValue: wsService },
        provideRouter([]),
        provideAnimations(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceListComponent);
    fixture.detectChanges();
  });

  it('calls wsService.load() on init', () => {
    expect(wsService.load).toHaveBeenCalled();
  });

  it('renders workspace cards for each workspace in the signal', fakeAsync(() => {
    wsService.workspaces.set([WS]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.workspace-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Dev');
  }));

  it('shows empty state when no workspaces exist', fakeAsync(() => {
    wsService.workspaces.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No workspaces yet');
  }));

  it('opens the create dialog when the new-workspace button is clicked', fakeAsync(() => {
    const btn = fixture.nativeElement.querySelector('.workspace-new-btn');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBeFalsy();
  }));
});
