// Persistence for named log searches, stored in extension global state.

import * as vscode from 'vscode';
import { SavedSearch } from './types.js';

const STORAGE_KEY = 'anypoint.logSearch.savedSearches';

export function getSavedSearches(context: vscode.ExtensionContext): SavedSearch[] {
  return context.globalState.get<SavedSearch[]>(STORAGE_KEY, []);
}

export async function saveSearch(
  context: vscode.ExtensionContext,
  search: Omit<SavedSearch, 'id' | 'createdAt'>
): Promise<SavedSearch> {
  const existing = getSavedSearches(context);
  const entry: SavedSearch = {
    ...search,
    id: `ls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now()
  };
  // Replace by name if one already exists, otherwise append.
  const next = existing.filter((s) => s.name.toLowerCase() !== entry.name.toLowerCase());
  next.push(entry);
  await context.globalState.update(STORAGE_KEY, next);
  return entry;
}

export async function deleteSavedSearch(context: vscode.ExtensionContext, id: string): Promise<void> {
  const next = getSavedSearches(context).filter((s) => s.id !== id);
  await context.globalState.update(STORAGE_KEY, next);
}
