import { useCallback, useEffect, useState } from 'react';

import { useSheetEditor } from '../hooks/useSheetEditor';
import { useTextPrompt } from './PromptDialog';
import { useSourceAnnotations } from '../hooks/useSourceAnnotations';
import { AnnotationLayer } from './AnnotationLayer';
import { CoordinateInspector } from './CoordinateInspector';
import { PropertiesPanel } from './PropertiesPanel';
import { SheetCanvas } from './SheetCanvas';
import { ToolPalette } from './ToolPalette';

/**
 * Composes the canvas, the markup overlay, the tool palette and the properties
 * panel into one editing surface.
 *
 * Owns the WIRING only. It performs no coordinate maths, contains no branch on
 * tool or annotation type, and does not know what undo is — those rules live in
 * `AnnotationService`, the tools, and `EditorService` respectively.
 */
export function SheetViewer({ sheetId, documentName, page, scale, rotation }) {
  // How a tool that declares `requiresText()` gets its text. Owned here rather
  // than inside the hook so the hook stays free of JSX and of any opinion about
  // HOW the question is asked — replacing this modal with an inline editor on
  // the sheet is a change to this file alone.
  const { ask: promptForText, dialog: promptDialog } = useTextPrompt();

  const editor = useSheetEditor({
    sheetId,
    documentName,
    page,
    scale,
    rotation,
    promptForText,
  });

  // Comments that were already in the uploaded PDF. Read-only.
  //
  // DEFAULT OFF, deliberately. Shown by default it was actively confusing: open
  // a file you exported earlier and every one of YOUR OWN markups comes back as
  // an "existing comment", so the sheet fills with dashed boxes drawn around
  // things you already drew. The information is genuinely useful when a file
  // arrives already marked up by someone else — but that is the rarer case, and
  // it should be something the user asks for rather than something they have to
  // work out how to turn off.
  const sourceAnnotations = useSourceAnnotations(page);
  const [showSource, setShowSource] = useState(false);

  const selectById = useCallback(
    (annotation) => editor.select(annotation.id),
    [editor],
  );

  // Keyboard shortcuts. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z are what every user
  // already has in their fingers; Delete removes the selection; Escape clears
  // it. Bound at the document level so they work wherever focus happens to be
  // on the sheet — except inside a text field, where they mean something else.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;

      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && editor.selected) {
        event.preventDefault();
        // A keyboard shortcut bypasses the disabled Delete button, so the lock
        // has to be honoured here too. EditorService would refuse the write
        // anyway; checking first means the user gets silence rather than an
        // error banner for pressing a key that was never going to work.
        if (editor.lockFor(editor.selected).allowed) editor.remove(editor.selected);
        return;
      }
      if (event.key === 'Escape') editor.select(null);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  return (
    <>
      {promptDialog}

      <ToolPalette
        activeToolId={editor.toolId}
        onSelectTool={editor.selectTool}
        style={editor.style}
        onChangeStyle={editor.setStyle}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        undoLabel={editor.undoLabel}
        redoLabel={editor.redoLabel}
        onUndo={editor.undo}
        onRedo={editor.redo}
        sourceCount={sourceAnnotations.length}
        showSource={showSource}
        onToggleSource={() => setShowSource((on) => !on)}
      />

      {editor.error && <p className="error">{editor.error}</p>}

      <div className="workspace">
        <div className="sheet-stage">
          {/* .sheet-frame is position:relative + inline-block, which anchors the
              absolutely-positioned overlay and shrinks the wrapper to exactly
              the canvas, so the overlay's bounding rect equals the canvas's. */}
          <div className="sheet-frame">
            <SheetCanvas page={page} scale={scale} rotation={rotation} />
            <AnnotationLayer
              page={page}
              scale={scale}
              rotation={rotation}
              annotations={editor.visible}
              sourceAnnotations={sourceAnnotations}
              showSource={showSource}
              selectedId={editor.selectedId}
              sealedIds={editor.sealedIds}
              incompleteIds={editor.incompleteIds}
              onSelect={selectById}
              onGestureStart={editor.begin}
              onGestureMove={editor.extend}
              onGestureEnd={editor.finish}
              onGestureCancel={editor.cancel}
            />
          </div>
        </div>

        <PropertiesPanel
          annotation={editor.selected}
          onUpdate={editor.update}
          onDelete={editor.remove}
          onClose={() => editor.select(null)}
          // The panel is handed the DECISION, not the reason for it. It shows
          // whatever explanation the policy gives, so when roles are switched
          // on it renders those refusals correctly with no change here.
          lock={editor.selected ? editor.lockFor(editor.selected) : undefined}
          // What is still missing, and who last touched it. Both are looked up
          // through the service, so the panel renders them without knowing what
          // a rule is or where attribution is stored.
          problems={editor.selected ? editor.problemsFor(editor.selected) : undefined}
          lastChange={editor.selected ? editor.lastChangeFor(editor.selected) : null}
        />
      </div>

      <CoordinateInspector
        page={page}
        scale={scale}
        rotation={rotation}
        annotations={editor.annotations}
        selectedId={editor.selectedId}
        onClear={editor.clearSheet}
      />
    </>
  );
}
