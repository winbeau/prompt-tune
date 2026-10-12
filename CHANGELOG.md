# Changelog

## 0.1.3

- Tune now targets natural, idiomatic English through focused phrase and clause rewrites while preserving intent and constraints.
- Capitalization, whitespace and terminal full stops are corrected silently; legacy presentation-only edits and their pattern evidence are removed without deleting saved prompts.
- Sage correction capsules, clearer phrase comparisons and compact dismissal controls.
- Streamed output measures its actual padded width and caret, with smooth field and window growth during soft wrapping and font or width changes.
- The window follows content height without a per-field cap, showing a page scrollbar only at the screen's available height; background streaming keeps resizing active.
- Independent translation and tuning requests across all three protocols, with regression checks for consecutive translations and embedded instructions.
- Return submits the selected mode even when the mode switch has keyboard focus; switching restores focus to the input.
- Theme palettes switch together without interpolating mismatched text and backgrounds; clearer secondary text and readable colored controls in both themes.
- macOS packages receive and verify an ad-hoc signature before installer creation, avoiding stale signatures from renamed Electron bundles.

## 0.1.2

- Larger 16px default text, adjustable from 12–24px with a custom slider and persistent cross-window settings.
- Command/Control +/−/0 shortcuts and menu actions for text size; text areas retain three visible lines at every size.
- Narrower 480px floating panel and a smaller, denser settings window.
- Comfortable tab padding, gentle selection states and soft sage/blue Tune/Translate capsules.
- Updated screenshots and a real DeepSeek translation/tuning GIF in the README.

## 0.1.1

- Compact five-row panel with three-line input/output that smoothly grow with content.
- Return submits; Shift+Return adds a line, with IME composition protection.
- System, Light and Black themes, synchronized across windows and persisted.
- Refined button states, streaming animation, copy action and model picker.
- Close and minimize controls; removed the unavailable fullscreen control.

## 0.1.0

- Floating, resizable desktop panel with native macOS shortcuts and tray access.
- Chinese-to-English translation and minimal English prompt tuning.
- Chinese/English UI with a separate explanation-language preference.
- Lightweight model management for DeepSeek, OpenCode Zen/Go, and compatible third-party APIs.
- Chat Completions, Responses, and Messages text adapters with streaming, cancellation and bounded retries.
- Encrypted credentials, local history, evidence-backed recurring patterns, and automatic summaries every 10 saved rounds.
- MIT license, dependency notices, desktop verification and release build workflows.
