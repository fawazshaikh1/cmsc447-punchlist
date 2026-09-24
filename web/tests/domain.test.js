import { describe, expect, it } from 'vitest';
import { Command } from '../src/domain/commands/Command';
import { CommandHistory } from '../src/domain/commands/CommandHistory';
import { PdfPoint } from '../src/domain/geometry/PdfPoint';
import { ViewportPoint } from '../src/domain/geometry/ViewportPoint';
import { PageGeometry } from '../src/domain/geometry/PageGeometry';
import { PdfJsCoordinateTransformer } from '../src/infrastructure/pdf/PdfJsCoordinateTransformer';
import { AnnotationRegistry } from '../src/domain/annotations/AnnotationRegistry';
import { Pin } from '../src/domain/annotations/Pin';

class CounterCommand extends Command {
  constructor(counter) { super(); this.counter = counter; }
  describe() { return 'Increment'; }
  async execute() { if (this.failExecute) throw new Error('write failed'); this.counter.value++; }
  async undo() { if (this.failUndo) throw new Error('write failed'); this.counter.value--; }
}

describe('undo and redo', () => {
  it('restores state, supports redo, and discards redo after a new edit', async () => {
    const counter = { value: 0 }, history = new CommandHistory();
    await history.execute(new CounterCommand(counter));
    await history.undo(); expect(counter.value).toBe(0);
    await history.redo(); expect(counter.value).toBe(1);
    await history.undo(); await history.execute(new CounterCommand(counter));
    expect(history.canRedo()).toBe(false);
  });
  it('does not record failed writes or lose history on failed undo/redo', async () => {
    const counter = { value: 0 }, history = new CommandHistory(), command = new CounterCommand(counter);
    command.failExecute = true;
    await expect(history.execute(command)).rejects.toThrow('write failed');
    expect(history.canUndo()).toBe(false);
    command.failExecute = false; await history.execute(command);
    command.failUndo = true;
    await expect(history.undo()).rejects.toThrow();
    expect(history.canUndo()).toBe(true); expect(counter.value).toBe(1);
    command.failUndo = false; await history.undo(); command.failExecute = true;
    await expect(history.redo()).rejects.toThrow();
    expect(history.canRedo()).toBe(true); expect(counter.value).toBe(0);
  });
  it('caps history and clears it when switching sheets', async () => {
    const history = new CommandHistory(2), counter = { value: 0 };
    for (let i = 0; i < 3; i++) await history.execute(new CounterCommand(counter));
    await history.undo(); await history.undo(); expect(await history.undo()).toBe(null);
    expect(counter.value).toBe(1);
    history.clear(); expect(history.canUndo()).toBe(false); expect(history.canRedo()).toBe(false);
  });
});

describe('coordinate boundaries', () => {
  it('converts CSS coordinates through the viewport and rejects the wrong space', () => {
    // Known 2x viewport with a flipped Y axis; exercises the adapter contract.
    const transform = new PdfJsCoordinateTransformer({
      scale: 2, rotation: 0, width: 2448, height: 1584,
      convertToPdfPoint: (x, y) => [x / 2, 792 - y / 2],
      convertToViewportPoint: (x, y) => [x * 2, (792 - y) * 2],
    });
    const point = transform.toPdfPoint(new ViewportPoint(100, 100));
    expect(point).toEqual(new PdfPoint(50, 742));
    expect(transform.toViewportPoint(point)).toEqual(new ViewportPoint(100, 100));
    expect(() => transform.toPdfPoint(point)).toThrow();
    expect(() => transform.toViewportPoint(new ViewportPoint(1, 2))).toThrow();
  });
  it('keeps pins in PDF space and clamps touches to the page boundary', () => {
    const page = new PageGeometry(612, 792);
    expect(page.contains(new PdfPoint(0, 792))).toBe(true);
    expect(page.contains(new PdfPoint(-1, 0))).toBe(false);
    expect(page.clamp(new PdfPoint(-10, 900))).toEqual(new PdfPoint(0, 792));
    expect(() => page.contains(new ViewportPoint(1, 2))).toThrow();
    expect(() => new Pin('p', 's', new ViewportPoint(1, 2), '', 'open', new Date())).toThrow();
  });
});

describe('annotation registry', () => {
  it('round-trips a pin without changing position or status', () => {
    const pin = new Pin('p', 's', new PdfPoint(32, 64), 'Repair door', 'open', new Date('2026-09-01T00:00:00Z'));
    expect(AnnotationRegistry.fromJSON(pin.toJSON()).toJSON()).toEqual(pin.toJSON());
  });
  it('skips unknown kinds only through the tolerant API', () => {
    expect(AnnotationRegistry.tryFromJSON({ kind: 'future-kind' })).toBe(null);
    expect(() => AnnotationRegistry.fromJSON({ kind: 'future-kind' })).toThrow('Unknown annotation kind');
  });
});
