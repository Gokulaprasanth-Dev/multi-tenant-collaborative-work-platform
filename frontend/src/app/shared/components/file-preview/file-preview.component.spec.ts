// frontend/src/app/shared/components/file-preview/file-preview.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilePreviewComponent } from './file-preview.component';

describe('FilePreviewComponent', () => {
  let fixture: ComponentFixture<FilePreviewComponent>;
  let component: FilePreviewComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilePreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilePreviewComponent);
    component = fixture.componentInstance;
  });

  it('should render <img> for image MIME types', () => {
    component.url = 'https://example.com/img.png';
    component.mimeType = 'image/png';
    component.filename = 'img.png';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeTruthy();
  });

  it('should render <iframe> for application/pdf', () => {
    component.url = 'https://example.com/doc.pdf';
    component.mimeType = 'application/pdf';
    component.filename = 'doc.pdf';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('iframe')).toBeTruthy();
  });

  it('should render <video> for video MIME types', () => {
    component.url = 'https://example.com/clip.mp4';
    component.mimeType = 'video/mp4';
    component.filename = 'clip.mp4';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('video')).toBeTruthy();
  });

  it('should render <audio> for audio MIME types', () => {
    component.url = 'https://example.com/sound.mp3';
    component.mimeType = 'audio/mpeg';
    component.filename = 'sound.mp3';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('audio')).toBeTruthy();
  });

  it('should render download anchor for unknown MIME types', () => {
    component.url = 'https://example.com/archive.zip';
    component.mimeType = 'application/zip';
    component.filename = 'archive.zip';
    fixture.detectChanges();
    const anchor: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[download]');
    expect(anchor).toBeTruthy();
    expect(anchor?.textContent).toContain('archive.zip');
  });

  it('should render download anchor for application/vnd.openxmlformats', () => {
    component.url = 'https://example.com/file.xlsx';
    component.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    component.filename = 'file.xlsx';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[download]')).toBeTruthy();
  });
});
