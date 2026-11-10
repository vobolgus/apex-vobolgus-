/**
 * Keep a press of the mouse from moving the keyboard focus onto a control.
 *
 * The keys belong to the sky: arrows turn it, from wherever the pointer happens to
 * be. A control that takes arrows of its own (a radio group steps its selection, a
 * list of switches walks its rows) is right to do so for someone who tabbed to it.
 * Clicked with the mouse it must not hold on to the focus, or the arrows that
 * turned the sky a moment ago now flip the projection, until a click elsewhere
 * lets go. So a mouse press leaves the focus where it was; Tab, and a click made
 * from the keyboard, focus the control as ever.
 *
 * Use as `onmousedown`. The pinhole frame's handles do the same.
 */
export function keepFocusOnMousePress(event: MouseEvent) {
	event.preventDefault();
}
