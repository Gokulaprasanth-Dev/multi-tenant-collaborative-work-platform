// frontend/src/app/shared/components/loading-spinner/loading-spinner.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spinner-wrap" [class.full]="full">
      <div class="spinner"></div>
    </div>
  `,
  styles: [`
    .spinner-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      &.full { min-height: 100vh; }
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(168,85,247,0.3);
      border-top-color: #a855f7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class LoadingSpinnerComponent {
  @Input() full = false;
}
