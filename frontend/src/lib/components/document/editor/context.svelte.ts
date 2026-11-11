/**
 * What the page editor's controllers share: the document, the stage, the focus, and
 * the two ways the editor speaks, its live region and the page's toast.
 */

import type { DocumentStore } from '$lib/document/document.svelte';
import type { EditorFocus } from './focus';
import type { EditorStage } from './stage.svelte';

export interface EditorContext {
	readonly store: DocumentStore;
	readonly stage: EditorStage;
	readonly focus: EditorFocus;
	/** False once the editor has closed: an Undo that comes after shows and says nothing here. */
	readonly isOpen: boolean;
	/** Read `message` out. */
	readonly announce: (message: string) => void;
	/** Show a toast, with an Undo button when `undo` is given. */
	readonly notify: (message: string, undo?: () => void) => void;
}
