// frontend/src/app/shared/components/file-chip/file-chip.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileChipComponent } from './file-chip.component';
import { FileUpload } from '../../../core/models/file.model';

const makeUpload = (overrides: Partial<FileUpload>): FileUpload => ({
  id: 'u-1', file: new File(['x'], 'test.txt', { type: 'text/plain' }),
  state: 'pending', progress: 0, ...overrides,
});

describe('FileChipComponent', () => {
  let fixture: ComponentFixture<FileChipComponent>;
  let component: FileChipComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FileChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(FileChipComponent);
    component = fixture.componentInstance;
  });

  it('should display filename', () => {
    component.upload = makeUpload({ file: new File(['x'], 'report.pdf', { type: 'application/pdf' }) });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('report.pdf');
  });

  it('should show progress bar only in uploading state', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 42 });
    fixture.detectChanges();
    const bar: HTMLElement | null = fixture.nativeElement.querySelector('.chip-progress');
    expect(bar).toBeTruthy();

    component.upload = makeUpload({ state: 'ready', fileId: 'f-1' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chip-progress')).toBeNull();
  });

  it('should show cancel button only in uploading state', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 10 });
    fixture.detectChanges();
    const cancel: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="cancel-btn"]');
    expect(cancel).toBeTruthy();
  });

  it('should emit cancel event on cancel button click', () => {
    component.upload = makeUpload({ state: 'uploading', progress: 10 });
    fixture.detectChanges();
    const spy = jest.spyOn(component.cancel, 'emit');
    fixture.nativeElement.querySelector('[data-testid="cancel-btn"]').click();
    expect(spy).toHaveBeenCalledWith('u-1');
  });

  it('should show dismiss button for rejected, cancelled, error states', () => {
    for (const state of ['rejected', 'cancelled', 'error'] as const) {
      component.upload = makeUpload({ state });
      fixture.detectChanges();
      const dismiss: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="dismiss-btn"]');
      expect(dismiss).toBeTruthy();
    }
  });

  it('should emit dismiss event on dismiss button click', () => {
    component.upload = makeUpload({ state: 'rejected', error: 'virus' });
    fixture.detectChanges();
    const spy = jest.spyOn(component.dismiss, 'emit');
    fixture.nativeElement.querySelector('[data-testid="dismiss-btn"]').click();
    expect(spy).toHaveBeenCalledWith('u-1');
  });

  it('should apply error class for rejected state', () => {
    component.upload = makeUpload({ state: 'rejected' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chip').classList).toContain('chip--rejected');
  });
});
