// frontend/src/app/shared/components/file-upload/file-upload.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FileUploadComponent } from './file-upload.component';
import { FileService } from '../../../core/services/file.service';
import { Subject } from 'rxjs';
import { FileUpload } from '../../../core/models/file.model';

const mockFile = (name = 'test.txt') => new File(['x'], name, { type: 'text/plain' });

describe('FileUploadComponent', () => {
  let fixture: ComponentFixture<FileUploadComponent>;
  let component: FileUploadComponent;
  let fileServiceUpload: jest.Mock;
  let uploadSubject: Subject<Partial<FileUpload>>;

  beforeEach(async () => {
    uploadSubject = new Subject();
    fileServiceUpload = jest.fn().mockReturnValue(uploadSubject.asObservable());

    await TestBed.configureTestingModule({
      imports: [FileUploadComponent],
      providers: [{ provide: FileService, useValue: { upload: fileServiceUpload } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FileUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should start with empty uploads list', () => {
    expect(component.uploads().length).toBe(0);
  });

  it('should add chip immediately when file is picked', () => {
    component.onFilesSelected([mockFile()]);
    expect(component.uploads().length).toBe(1);
    expect(component.uploads()[0].state).toBe('pending');
  });

  it('should transition to uploading once FileService emits uploading', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 0 });
    expect(component.uploads()[0].state).toBe('uploading');
  });

  it('should emit fileReady when state becomes ready', () => {
    const readyIds: string[] = [];
    component.fileReady.subscribe((id: string) => readyIds.push(id));

    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'ready', fileId: 'f-abc' });

    expect(readyIds).toEqual(['f-abc']);
  });

  it('should not emit fileReady for non-ready states', () => {
    const readyIds: string[] = [];
    component.fileReady.subscribe((id: string) => readyIds.push(id));

    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 50 });
    uploadSubject.next({ state: 'scanning' });

    expect(readyIds).toEqual([]);
  });

  it('should mark hasPending true while uploading', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 10 });
    expect(component.hasPending()).toBe(true);
  });

  it('should remove upload on dismiss', () => {
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'rejected', error: 'virus' });
    const id = component.uploads()[0].id;
    component.onDismiss(id);
    expect(component.uploads().length).toBe(0);
  });

  it('should abort xhr and mark cancelled on cancel', () => {
    const mockXhr = { abort: jest.fn() } as unknown as XMLHttpRequest;
    component.onFilesSelected([mockFile()]);
    uploadSubject.next({ state: 'uploading', progress: 10, xhr: mockXhr });
    const id = component.uploads()[0].id;
    component.onCancel(id);
    expect(mockXhr.abort).toHaveBeenCalled();
    uploadSubject.next({ state: 'cancelled' });
    expect(component.uploads()[0].state).toBe('cancelled');
  });

  it('should handle paste event with files', () => {
    const file = mockFile('pasted.png');
    const pasteEvent = { clipboardData: { files: [file] } } as unknown as ClipboardEvent;
    component.onPaste(pasteEvent);
    expect(component.uploads().length).toBe(1);
  });
});
