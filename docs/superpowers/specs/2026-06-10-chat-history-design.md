# Chat History — Design Spec

**Date:** 2026-06-10  
**Status:** Approved

## Overview

Add multi-conversation support to the Safari AI Agent extension. The user can have multiple saved chats, switch between them via a dropdown overlay, and start new chats manually. At any time exactly one conversation is active.

---

## Data Storage

Three keys in `browser.storage.local`:

| Key | Type | Description |
|-----|------|-------------|
| `conversations_index` | `Array<{id, title, updatedAt}>` | Ordered list of all conversations, newest first |
| `conv_<id>` | `Array<{role, content}>` | Messages for a single conversation (same format as existing `chatHistory`) |
| `active_conv_id` | `string` | ID of the currently active conversation |

- **ID format:** `Date.now().toString(36)` — short, unique, no external dependency
- **Title:** First user message truncated to 60 characters
- **Max conversations:** 50 — when exceeded, the oldest is automatically deleted
- **Per-conversation size limit:** 512 KB (unchanged from current behavior)
- **Migration:** On first launch after update, existing `chatHistory` is imported as the first conversation and `chatHistory` key is removed

---

## UI

### History Button

A clock icon button is added to the top toolbar, next to the existing "Clear" button. Clicking it toggles the history dropdown overlay.

### Dropdown Overlay

- Positioned directly below the toolbar, full popup width
- Scrollable list of conversations, newest first
- Each row shows: **title** (truncated) + **relative date** ("heute", "gestern", "vor 3 Tagen")
- The currently active conversation is visually highlighted
- Clicking a conversation: loads it, closes the overlay
- Clicking outside the overlay: closes it without action

### "New Chat" Entry

- Pinned at the top of the dropdown list, always visible
- Clicking it: saves the current conversation (if it has at least one message), creates a new empty conversation, sets it as active, closes the overlay
- If the current chat is empty (no messages), clicking "New Chat" does nothing (no duplicate empty chats)

---

## Behavior & Edge Cases

- **Invalid active ID:** If `active_conv_id` points to a non-existent conversation (e.g. after max-limit deletion), a new conversation is started automatically on load
- **Empty chat guard:** A conversation with zero messages is never persisted to `conversations_index`
- **Existing clear button:** Clears the current conversation's messages but keeps the conversation entry in the index (title becomes empty/placeholder until first new message)
- **Relative dates:** Computed client-side at render time; no server dependency

---

## Files Affected

- `Safari AI Agent Extension/Resources/popup.js` — all storage logic and UI event handling
- `Safari AI Agent Extension/Resources/popup.html` — add history button and dropdown container
- `Safari AI Agent Extension/Resources/popup.css` — styles for history button, dropdown, active highlight
