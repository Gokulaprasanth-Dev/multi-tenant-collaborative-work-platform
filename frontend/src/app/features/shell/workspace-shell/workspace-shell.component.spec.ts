// frontend/src/app/features/shell/workspace-shell/workspace-shell.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { WorkspaceShellComponent } from './workspace-shell.component';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ChannelService } from '../../../core/services/channel.service';

describe('WorkspaceShellComponent', () => {
  let fixture: ComponentFixture<WorkspaceShellComponent>;
  let wsSvc: { loadOne: jest.Mock; activeWorkspace: jest.Mock };
  let chSvc: { load: jest.Mock; channels: jest.Mock };

  beforeEach(async () => {
    wsSvc = {
      loadOne:         jest.fn().mockReturnValue(of({})),
      activeWorkspace: jest.fn().mockReturnValue(null),
    };
    chSvc = {
      load:     jest.fn().mockReturnValue(of([])),
      channels: jest.fn().mockReturnValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceShellComponent],
      providers: [
        { provide: WorkspaceService, useValue: wsSvc },
        { provide: ChannelService,   useValue: chSvc },
        provideRouter([]),
        provideAnimations(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ws-1' } } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceShellComponent);
    fixture.detectChanges();
  });

  it('calls loadOne() and ChannelService.load() with the route :id on init', fakeAsync(() => {
    tick();
    expect(wsSvc.loadOne).toHaveBeenCalledWith('ws-1');
    expect(chSvc.load).toHaveBeenCalledWith('ws-1');
  }));

  it('renders the workspace-shell container', () => {
    expect(fixture.nativeElement.querySelector('.workspace-shell')).toBeTruthy();
  });

  it('renders the workspace sidebar', () => {
    expect(fixture.nativeElement.querySelector('app-workspace-sidebar')).toBeTruthy();
  });
});
