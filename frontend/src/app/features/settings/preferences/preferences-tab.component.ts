// frontend/src/app/features/settings/preferences/preferences-tab.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Subject, distinctUntilChanged } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { UserService } from '../../../core/services/user.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/services/auth.service';

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland',
];

const LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文 (简体)' },
];

@Component({
  selector: 'app-preferences-tab',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatSelectModule],
  template: `
    <h2 style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 0.5rem;">Preferences</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 1.5rem;">Changes save automatically.</p>

    <div style="display:flex;flex-direction:column;gap:1rem;max-width:400px;" [formGroup]="form">

      <mat-form-field appearance="outline">
        <mat-label>Timezone</mat-label>
        <mat-select formControlName="timezone">
          @for (tz of timezones; track tz) {
            <mat-option [value]="tz">{{ tz }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Language / Locale</mat-label>
        <mat-select formControlName="locale">
          @for (l of locales; track l.value) {
            <mat-option [value]="l.value">{{ l.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Theme</mat-label>
        <mat-select formControlName="theme">
          <mat-option value="dark">Dark</mat-option>
          <mat-option value="light">Light</mat-option>
          <mat-option value="system">System</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Date format</mat-label>
        <mat-select formControlName="dateFormat">
          <mat-option value="DD/MM/YYYY">DD/MM/YYYY</mat-option>
          <mat-option value="MM/DD/YYYY">MM/DD/YYYY</mat-option>
          <mat-option value="YYYY-MM-DD">YYYY-MM-DD</mat-option>
        </mat-select>
      </mat-form-field>

    </div>
  `,
})
export class PreferencesTabComponent implements OnInit, OnDestroy {
  private userService  = inject(UserService);
  private themeService = inject(ThemeService);
  private auth         = inject(AuthService);
  private fb           = inject(FormBuilder);
  private destroy$     = new Subject<void>();

  readonly timezones = TIMEZONES;
  readonly locales   = LOCALES;

  readonly form = this.fb.nonNullable.group({
    timezone:   ['UTC'],
    locale:     ['en-US'],
    theme:      ['dark' as 'dark' | 'light' | 'system'],
    dateFormat: ['DD/MM/YYYY' as 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'],
  });

  ngOnInit(): void {
    const prefs = this.auth.currentUser()?.preferences;
    if (prefs) this.form.patchValue(prefs, { emitEvent: false });

    this.form.controls.theme.valueChanges.pipe(
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(t => this.themeService.apply(t));

    this.form.valueChanges.pipe(
      debounceTime(1000),
      takeUntil(this.destroy$),
    ).subscribe(v => this.userService.savePreferences(v).subscribe());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
