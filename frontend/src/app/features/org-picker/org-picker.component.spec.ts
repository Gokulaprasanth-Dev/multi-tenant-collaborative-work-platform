// frontend/src/app/features/org-picker/org-picker.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { OrgPickerComponent } from './org-picker.component';
import { TenantService } from '../../core/services/tenant.service';
import { Org } from '../../core/models/org.model';

const ORG: Org = { id: 'org-1', name: 'Acme', slug: 'acme', status: 'active', plan: 'free' };

describe('OrgPickerComponent', () => {
  let fixture: ComponentFixture<OrgPickerComponent>;
  let component: OrgPickerComponent;
  let tenant: { userOrgs: ReturnType<typeof signal<Org[]>>; setOrg: jest.Mock; loadUserOrgs: jest.Mock };
  let router: Router;

  beforeEach(async () => {
    tenant = {
      userOrgs:     signal<Org[]>([]),
      setOrg:       jest.fn(),
      loadUserOrgs: jest.fn().mockReturnValue(of([ORG])),
    };

    await TestBed.configureTestingModule({
      imports: [OrgPickerComponent],
      providers: [
        { provide: TenantService, useValue: tenant },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture   = TestBed.createComponent(OrgPickerComponent);
    component = fixture.componentInstance;
    router    = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('calls loadUserOrgs on init', () => {
    expect(tenant.loadUserOrgs).toHaveBeenCalled();
  });

  it('renders an org item for each org in userOrgs', fakeAsync(() => {
    tenant.userOrgs.set([ORG]);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.org-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Acme');
  }));

  it('selectOrg() sets the org in TenantService and navigates to /app', fakeAsync(() => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    component.selectOrg(ORG);
    expect(tenant.setOrg).toHaveBeenCalledWith(ORG);
    expect(navSpy).toHaveBeenCalledWith(['/app']);
  }));
});
